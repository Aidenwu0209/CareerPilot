import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  careerGuidanceNotes,
  careerProfileSnapshots,
} from '@/lib/db/schema';
import { authorizeTeacherStudentMutation } from '@/app/api/teacher/_shared';

const reviewSchema = z.object({
  decision: z.enum(['confirmed', 'rejected']),
  reason: z.string().trim().min(2).max(1000),
}).strict();

const evidenceIdSchema = z.string().trim().min(1).max(128);

class EvidenceReviewConflictError extends Error {
  constructor() {
    super('EVIDENCE_ALREADY_REVIEWED');
    this.name = 'EvidenceReviewConflictError';
  }
}

function auditContent(input: {
  evidenceId: string;
  evidenceTitle: string;
  decision: 'confirmed' | 'rejected';
  reason: string;
}) {
  const decisionLabel = input.decision === 'confirmed' ? '确认通过' : '退回';
  return [
    `证据审核：${decisionLabel}`,
    `证据：${input.evidenceTitle}（${input.evidenceId}）`,
    `理由：${input.reason}`,
  ].join('\n');
}

async function persistReview(input: {
  studentId: string;
  actorUserId: string;
  evidenceId: string;
  evidenceTitle: string;
  decision: 'confirmed' | 'rejected';
  reason: string;
}) {
  const status = input.decision === 'confirmed' ? 'verified' as const : 'rejected' as const;
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

  if (config.db.type === 'sqlite') {
    db.transaction((tx: any) => {
      const updated = tx.update(careerEvidence)
        .set({
          status,
          reviewedBy: input.actorUserId,
          reviewReason: input.reason,
          reviewedAt: new Date(),
        })
        .where(reviewWhere)
        .returning({ id: careerEvidence.id })
        .all();
      if (updated.length !== 1) throw new EvidenceReviewConflictError();
      tx.insert(careerGuidanceNotes).values(note).run();

      const abilities = tx.select({
        code: careerAbilities.code,
        name: careerAbilities.name,
        dimension: careerAbilities.dimension,
        score: careerAbilities.score,
      }).from(careerAbilities)
        .where(eq(careerAbilities.userId, input.studentId))
        .all();
      const latestSnapshot = tx.select({ version: careerProfileSnapshots.version })
        .from(careerProfileSnapshots)
        .where(eq(careerProfileSnapshots.userId, input.studentId))
        .orderBy(desc(careerProfileSnapshots.version))
        .limit(1)
        .all()[0];
      tx.insert(careerProfileSnapshots).values({
        id: crypto.randomUUID(),
        userId: input.studentId,
        version: (latestSnapshot?.version ?? 0) + 1,
        abilities,
        trigger: `evidence_review:${input.decision}:${input.evidenceId}`,
      }).run();
    });
  } else {
    await db.transaction(async (tx: any) => {
      const updated = await tx.update(careerEvidence)
        .set({
          status,
          reviewedBy: input.actorUserId,
          reviewReason: input.reason,
          reviewedAt: new Date(),
        })
        .where(reviewWhere)
        .returning({ id: careerEvidence.id });
      if (updated.length !== 1) throw new EvidenceReviewConflictError();
      await tx.insert(careerGuidanceNotes).values(note);

      const abilities = await tx.select({
        code: careerAbilities.code,
        name: careerAbilities.name,
        dimension: careerAbilities.dimension,
        score: careerAbilities.score,
      }).from(careerAbilities)
        .where(eq(careerAbilities.userId, input.studentId));
      const latestSnapshot = (await tx.select({ version: careerProfileSnapshots.version })
        .from(careerProfileSnapshots)
        .where(eq(careerProfileSnapshots.userId, input.studentId))
        .orderBy(desc(careerProfileSnapshots.version))
        .limit(1))[0];
      await tx.insert(careerProfileSnapshots).values({
        id: crypto.randomUUID(),
        userId: input.studentId,
        version: (latestSnapshot?.version ?? 0) + 1,
        abilities: JSON.stringify(abilities),
        trigger: `evidence_review:${input.decision}:${input.evidenceId}`,
      });
    });
  }

  return status;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentId: string; evidenceId: string }> },
) {
  try {
    const { studentId, evidenceId: rawEvidenceId } = await params;
    const evidenceId = evidenceIdSchema.safeParse(rawEvidenceId);
    if (!evidenceId.success) {
      return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 });
    }

    const authorization = await authorizeTeacherStudentMutation(studentId);
    if (!authorization.ok) return authorization.response;

    const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
    }

    const evidenceRows = await db.select({
      id: careerEvidence.id,
      title: careerEvidence.title,
      status: careerEvidence.status,
    }).from(careerEvidence).where(and(
      eq(careerEvidence.id, evidenceId.data),
      eq(careerEvidence.userId, authorization.studentId),
    )).limit(1);
    const evidence = evidenceRows[0];
    if (!evidence) {
      return NextResponse.json({ error: 'EVIDENCE_NOT_FOUND' }, { status: 404 });
    }
    if (evidence.status !== 'pending') {
      return NextResponse.json({ error: 'EVIDENCE_ALREADY_REVIEWED' }, { status: 409 });
    }

    const status = await persistReview({
      studentId: authorization.studentId,
      actorUserId: authorization.actorUserId,
      evidenceId: evidence.id,
      evidenceTitle: evidence.title,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
    });

    return NextResponse.json({
      ok: true,
      evidence: { id: evidence.id, status },
    });
  } catch (error) {
    if (error instanceof EvidenceReviewConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[Teacher API] Evidence review failed', error);
    return NextResponse.json({ error: 'EVIDENCE_REVIEW_FAILED' }, { status: 500 });
  }
}
