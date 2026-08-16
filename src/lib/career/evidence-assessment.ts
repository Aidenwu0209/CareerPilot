import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
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

type MaybePromise<T> = T | Promise<T>;

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === 'function';
}

function thenValue<T, U>(value: MaybePromise<T>, next: (resolved: T) => MaybePromise<U>): MaybePromise<U> {
  return isPromiseLike(value) ? value.then(next) : next(value);
}

export interface EvidenceReviewOperations {
  review(): MaybePromise<Array<{ id: string }>>;
  insertAuditNote(): MaybePromise<unknown>;
  aggregate(): MaybePromise<{ score: number | null; evidenceCount: number }>;
  upsertAbility(result: AssessedAbilityResult): MaybePromise<unknown>;
  listAbilities(): MaybePromise<Array<{ code: string; name: string; dimension: AbilityDimensionCode; score: number | null }>>;
  latestSnapshotVersion(): MaybePromise<number>;
  insertSnapshot(
    abilities: Array<{ code: string; name: string; dimension: AbilityDimensionCode; score: number | null }>,
    version: number,
  ): MaybePromise<unknown>;
}

function createReviewOperations(
  tx: any,
  input: EvidenceReviewInput,
  note: { id: string; userId: string; teacherId: string; visibility: 'management'; content: string },
  reviewWhere: ReturnType<typeof and>,
): EvidenceReviewOperations {
  const isSynchronous = tx.session?.constructor?.name === 'BetterSQLiteSession';
  const rows = <T>(query: any): MaybePromise<T[]> => isSynchronous ? query.all() as T[] : query as Promise<T[]>;
  const run = (query: any): MaybePromise<unknown> => isSynchronous ? query.run() : query;

  return {
    review: () => rows<{ id: string }>(
      tx.update(careerEvidence).set(reviewValues(input)).where(reviewWhere).returning({ id: careerEvidence.id }),
    ),
    insertAuditNote: () => run(tx.insert(careerGuidanceNotes).values(note)),
    aggregate: () => thenValue(
      rows<{ score: number | null; evidenceCount: number }>(aggregateSelection(tx, input.studentId, input.abilityCode)),
      (result) => result[0] ?? { score: null, evidenceCount: 0 },
    ),
    upsertAbility: (result) => run(tx.insert(careerAbilities).values({
      userId: input.studentId,
      ...result,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [careerAbilities.userId, careerAbilities.code],
      set: { ...result, updatedAt: new Date() },
    })),
    listAbilities: () => rows(snapshotSelection(tx, input.studentId)),
    latestSnapshotVersion: () => thenValue(
      rows<{ version: number }>(latestSnapshotSelection(tx, input.studentId)),
      (result) => result[0]?.version ?? 0,
    ),
    insertSnapshot: (abilities, version) => run(tx.insert(careerProfileSnapshots).values({
      id: crypto.randomUUID(),
      userId: input.studentId,
      version,
      abilities: isSynchronous ? abilities : JSON.stringify(abilities),
      trigger: `evidence_review:${input.decision}:${input.evidenceId}`,
    })),
  };
}

/** One transaction-neutral workflow shared by synchronous SQLite and asynchronous PostgreSQL drivers. */
export function executeEvidenceReviewWorkflow(
  operations: EvidenceReviewOperations,
  input: EvidenceReviewInput,
  definition: { name: string; dimension: AbilityDimensionCode },
): MaybePromise<AssessedAbilityResult> {
  return thenValue(operations.review(), (updated) => {
    if (updated.length !== 1) throw new EvidenceReviewConflictError();
    return thenValue(operations.insertAuditNote(), () => thenValue(operations.aggregate(), (aggregate) => {
      const result = abilityValues(input, definition, aggregate);
      return thenValue(operations.upsertAbility(result), () => thenValue(operations.listAbilities(), (abilities) => (
        thenValue(operations.latestSnapshotVersion(), (latestVersion) => (
          thenValue(operations.insertSnapshot(abilities, latestVersion + 1), () => result)
        ))
      )));
    }));
  });
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
  const transaction = db.transaction.bind(db) as unknown as (
    callback: (tx: any) => MaybePromise<AssessedAbilityResult>,
  ) => MaybePromise<AssessedAbilityResult>;
  return Promise.resolve(transaction((tx) => executeEvidenceReviewWorkflow(
    createReviewOperations(tx, input, note, reviewWhere),
    input,
    definition,
  )));
}
