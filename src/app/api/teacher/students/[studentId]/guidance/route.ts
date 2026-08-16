import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { careerGuidanceNotes } from '@/lib/db/schema';
import { authorizeTeacherStudentMutation } from '@/app/api/teacher/_shared';
import { logger } from '@/lib/observability/logger';

const guidanceSchema = z.object({
  visibility: z.enum(['student', 'private']),
  content: z.string().trim().min(2).max(2000),
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
      content: parsed.data.content,
    });

    return NextResponse.json({
      ok: true,
      guidance: {
        id,
        visibility: parsed.data.visibility,
        content: parsed.data.content,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error('teacher.guidance_creation_failed', { error });
    return NextResponse.json({ error: 'GUIDANCE_CREATE_FAILED' }, { status: 500 });
  }
}
