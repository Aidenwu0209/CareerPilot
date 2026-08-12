import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { careerEvidence } from '@/lib/db/schema';
import { authorizeTeacherStudentMutation } from '@/app/api/teacher/_shared';
import {
  EvidenceReviewConflictError,
  reviewAndAggregateCareerEvidence,
} from '@/lib/career/evidence-assessment';

const reasonSchema = z.string().trim().min(2).max(1000);
const reviewSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('confirmed'),
    reason: reasonSchema,
    score: z.number().int().min(0).max(100),
  }).strict(),
  z.object({
    decision: z.literal('rejected'),
    reason: reasonSchema,
  }).strict(),
]);

const evidenceIdSchema = z.string().trim().min(1).max(128);

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
      abilityCode: careerEvidence.abilityCode,
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

    const ability = await reviewAndAggregateCareerEvidence({
      studentId: authorization.studentId,
      actorUserId: authorization.actorUserId,
      evidenceId: evidence.id,
      evidenceTitle: evidence.title,
      abilityCode: evidence.abilityCode,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      score: parsed.data.decision === 'confirmed' ? parsed.data.score : undefined,
    });
    const status = parsed.data.decision === 'confirmed' ? 'verified' : 'rejected';

    return NextResponse.json({
      ok: true,
      evidence: {
        id: evidence.id,
        status,
        assessedScore: parsed.data.decision === 'confirmed' ? parsed.data.score : null,
      },
      ability,
    });
  } catch (error) {
    if (error instanceof EvidenceReviewConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[Teacher API] Evidence review failed', error);
    return NextResponse.json({ error: 'EVIDENCE_REVIEW_FAILED' }, { status: 500 });
  }
}
