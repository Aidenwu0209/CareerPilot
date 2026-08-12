import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { config } from '@/lib/config';
import { db, dbReady } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  careerGuidanceNotes,
  careerProfileSnapshots,
  occupationRequirements,
  occupations,
} from '@/lib/db/schema';
import type { AbilityDimensionCode } from '@/types/career';
import { ABILITY_CATALOG } from './catalog';

export class EvidenceReviewConflictError extends Error {
  constructor() {
    super('EVIDENCE_ALREADY_REVIEWED');
    this.name = 'EvidenceReviewConflictError';
  }
}

export interface EvidenceReviewInput {
  studentId: string;
  actorUserId: string;
  evidenceId: string;
  evidenceTitle: string;
  abilityCode: string;
  decision: 'confirmed' | 'rejected';
  reason: string;
  score?: number;
}

export interface AssessedAbilityResult {
  code: string;
  name: string;
  dimension: AbilityDimensionCode;
  score: number | null;
  confidence: number | null;
  evidenceCount: number;
}

function auditContent(input: EvidenceReviewInput): string {
  const decisionLabel = input.decision === 'confirmed' ? '确认通过' : '退回';
  return [
    `证据审核：${decisionLabel}`,
    `证据：${input.evidenceTitle}（${input.evidenceId}）`,
    ...(input.score == null ? [] : [`量化评分：${input.score}`]),
    `理由：${input.reason}`,
  ].join('\n');
}

async function resolveAbilityDefinition(studentId: string, abilityCode: string): Promise<{
  name: string;
  dimension: AbilityDimensionCode;
}> {
  const existing = await db.select({ name: careerAbilities.name, dimension: careerAbilities.dimension })
    .from(careerAbilities)
    .where(and(eq(careerAbilities.userId, studentId), eq(careerAbilities.code, abilityCode)))
    .limit(1);
  if (existing[0]) return existing[0];

  const requirement = await db.select({
    name: occupationRequirements.abilityName,
    dimension: occupationRequirements.dimension,
  }).from(occupationRequirements)
    .innerJoin(occupations, and(
      eq(occupations.code, occupationRequirements.occupationCode),
      eq(occupations.active, true),
    ))
    .where(eq(occupationRequirements.abilityCode, abilityCode))
    .limit(1);
  if (requirement[0]) return requirement[0];

  const builtIn = ABILITY_CATALOG.find((item) => item.code === abilityCode);
  return builtIn ?? { name: abilityCode, dimension: 'general_competencies' };
}

function confidenceForEvidenceCount(evidenceCount: number): number | null {
  return evidenceCount > 0 ? Math.min(100, 50 + evidenceCount * 10) : null;
}

function aggregateSelection(tx: any, studentId: string, abilityCode: string) {
  return tx.select({
    score: sql<number | null>`round(avg(${careerEvidence.assessedScore}))`,
    evidenceCount: count(careerEvidence.id),
  }).from(careerEvidence).where(and(
    eq(careerEvidence.userId, studentId),
    eq(careerEvidence.abilityCode, abilityCode),
    eq(careerEvidence.status, 'verified'),
    isNotNull(careerEvidence.assessedScore),
  ));
}

function snapshotSelection(tx: any, studentId: string) {
  return tx.select({
    code: careerAbilities.code,
    name: careerAbilities.name,
    dimension: careerAbilities.dimension,
    score: careerAbilities.score,
  }).from(careerAbilities).where(eq(careerAbilities.userId, studentId));
}

function latestSnapshotSelection(tx: any, studentId: string) {
  return tx.select({ version: careerProfileSnapshots.version })
    .from(careerProfileSnapshots)
    .where(eq(careerProfileSnapshots.userId, studentId))
    .orderBy(desc(careerProfileSnapshots.version))
    .limit(1);
}

function abilityValues(
  input: EvidenceReviewInput,
  definition: { name: string; dimension: AbilityDimensionCode },
  aggregate: { score: number | null; evidenceCount: number },
): AssessedAbilityResult {
  const evidenceCount = Number(aggregate.evidenceCount ?? 0);
  return {
    code: input.abilityCode,
    name: definition.name,
    dimension: definition.dimension,
    score: aggregate.score == null ? null : Number(aggregate.score),
    confidence: confidenceForEvidenceCount(evidenceCount),
    evidenceCount,
  };
}

function reviewValues(input: EvidenceReviewInput) {
  return {
    status: input.decision === 'confirmed' ? 'verified' as const : 'rejected' as const,
    assessedScore: input.decision === 'confirmed' ? input.score! : null,
    reviewedBy: input.actorUserId,
    reviewReason: input.reason,
    reviewedAt: new Date(),
  };
}

/**
 * Confirm/reject evidence, aggregate all scored verified evidence for the
 * affected ability, and snapshot the resulting profile in one transaction.
 */
export async function reviewAndAggregateCareerEvidence(input: EvidenceReviewInput): Promise<AssessedAbilityResult> {
  await dbReady;
  const definition = await resolveAbilityDefinition(input.studentId, input.abilityCode);
  const note = {
    id: crypto.randomUUID(),
    userId: input.studentId,
    teacherId: input.actorUserId,
    visibility: 'management' as const,
    content: auditContent(input),
  };
  const reviewWhere = and(
    eq(careerEvidence.id, input.evidenceId),
    eq(careerEvidence.userId, input.studentId),
    eq(careerEvidence.status, 'pending'),
  );
  let result: AssessedAbilityResult | null = null;

  if (config.db.type === 'sqlite' || db.session?.constructor?.name === 'BetterSQLiteSession') {
    db.transaction((tx: any) => {
      const updated = tx.update(careerEvidence).set(reviewValues(input)).where(reviewWhere)
        .returning({ id: careerEvidence.id }).all();
      if (updated.length !== 1) throw new EvidenceReviewConflictError();
      tx.insert(careerGuidanceNotes).values(note).run();
      const aggregate = aggregateSelection(tx, input.studentId, input.abilityCode).all()[0] as {
        score: number | null;
        evidenceCount: number;
      };
      result = abilityValues(input, definition, aggregate);
      tx.insert(careerAbilities).values({
        userId: input.studentId,
        ...result,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [careerAbilities.userId, careerAbilities.code],
        set: { ...result, updatedAt: new Date() },
      }).run();
      const abilities = snapshotSelection(tx, input.studentId).all();
      const latest = latestSnapshotSelection(tx, input.studentId).all()[0];
      tx.insert(careerProfileSnapshots).values({
        id: crypto.randomUUID(),
        userId: input.studentId,
        version: (latest?.version ?? 0) + 1,
        abilities,
        trigger: `evidence_review:${input.decision}:${input.evidenceId}`,
      }).run();
    });
  } else {
    await db.transaction(async (tx: any) => {
      const updated = await tx.update(careerEvidence).set(reviewValues(input)).where(reviewWhere)
        .returning({ id: careerEvidence.id });
      if (updated.length !== 1) throw new EvidenceReviewConflictError();
      await tx.insert(careerGuidanceNotes).values(note);
      const aggregate = (await aggregateSelection(tx, input.studentId, input.abilityCode))[0] as {
        score: number | null;
        evidenceCount: number;
      };
      result = abilityValues(input, definition, aggregate);
      await tx.insert(careerAbilities).values({
        userId: input.studentId,
        ...result,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [careerAbilities.userId, careerAbilities.code],
        set: { ...result, updatedAt: new Date() },
      });
      const abilities = await snapshotSelection(tx, input.studentId);
      const latest = (await latestSnapshotSelection(tx, input.studentId))[0];
      await tx.insert(careerProfileSnapshots).values({
        id: crypto.randomUUID(),
        userId: input.studentId,
        version: (latest?.version ?? 0) + 1,
        abilities: JSON.stringify(abilities),
        trigger: `evidence_review:${input.decision}:${input.evidenceId}`,
      });
    });
  }

  if (!result) throw new Error('Evidence review transaction did not produce an ability result.');
  return result;
}
