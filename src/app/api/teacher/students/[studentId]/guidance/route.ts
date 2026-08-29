import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { careerGuidanceNotes } from '@/lib/db/schema';
import { authorizeTeacherStudentMutation } from '@/app/api/teacher/_shared';
import { logger } from '@/lib/observability/logger';

const guidanceSchema = z.object({
  visibility: z.enum(['student', 'private']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  followUpStatus: z.enum(['new', 'contacted', 'waiting_student', 'waiting_teacher', 'scheduled', 'resolved', 'on_hold']).default('new'),
  nextFollowUpAt: z.string().date().nullable().optional(),
  content: z.string().trim().min(2).max(2000),
}).strict();

const updateSchema = guidanceSchema.pick({ priority: true, followUpStatus: true, nextFollowUpAt: true }).extend({
  guidanceId: z.string().uuid(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const { studentId } = await params;
    const authorization = await authorizeTeacherStudentMutation(studentId);
    if (!authorization.ok) return authorization.response;

    const parsed = guidanceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await db.insert(careerGuidanceNotes).values({
      id,
      userId: authorization.studentId,
      teacherId: authorization.actorUserId,
      visibility: parsed.data.visibility === 'private' ? 'teacher_private' : 'student',
      priority: parsed.data.priority,
      followUpStatus: parsed.data.followUpStatus,
      nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(`${parsed.data.nextFollowUpAt}T12:00:00.000Z`) : null,
      content: parsed.data.content,
    });

    return NextResponse.json({
      ok: true,
      guidance: {
        id,
        visibility: parsed.data.visibility,
        priority: parsed.data.priority,
        followUpStatus: parsed.data.followUpStatus,
        nextFollowUpAt: parsed.data.nextFollowUpAt ?? null,
        content: parsed.data.content,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error('teacher.guidance_creation_failed', { error });
    return NextResponse.json({ error: 'GUIDANCE_CREATE_FAILED' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  try {
    const { studentId } = await params;
    const authorization = await authorizeTeacherStudentMutation(studentId);
    if (!authorization.ok) return authorization.response;
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
    const updated = await db.update(careerGuidanceNotes).set({
      priority: parsed.data.priority,
      followUpStatus: parsed.data.followUpStatus,
      nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(`${parsed.data.nextFollowUpAt}T12:00:00.000Z`) : null,
      updatedAt: new Date(),
    }).where(and(
      eq(careerGuidanceNotes.id, parsed.data.guidanceId),
      eq(careerGuidanceNotes.userId, authorization.studentId),
      eq(careerGuidanceNotes.teacherId, authorization.actorUserId),
    )).returning({ id: careerGuidanceNotes.id });
    if (!updated.length) return NextResponse.json({ error: 'GUIDANCE_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('teacher.guidance_update_failed', { error });
    return NextResponse.json({ error: 'GUIDANCE_UPDATE_FAILED' }, { status: 500 });
  }
}
