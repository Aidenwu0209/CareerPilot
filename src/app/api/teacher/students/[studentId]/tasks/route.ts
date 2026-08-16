import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { careerAbilities, careerGoals, careerTasks } from '@/lib/db/schema';
import {
  authorizeTeacherStudentMutation,
  parseCalendarDate,
} from '@/app/api/teacher/_shared';
import { logger } from '@/lib/observability/logger';

const taskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  abilityKey: z.string().trim().min(1).max(120),
  dueDate: z.string().trim().refine((value) => parseCalendarDate(value) !== null),
  reason: z.string().trim().min(2).max(1000),
  completionCriteria: z.string().trim().min(2).max(1000),
}).strict();

const ABILITY_DIMENSIONS = new Set([
  'domain_knowledge',
  'professional_skills',
  'project_practice',
  'general_competencies',
  'job_readiness',
  'growth_potential',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const { studentId } = await params;
    const authorization = await authorizeTeacherStudentMutation(studentId);
    if (!authorization.ok) return authorization.response;

    const parsed = taskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
    }

    const dueAt = parseCalendarDate(parsed.data.dueDate);
    if (!dueAt) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
    }

    if (!ABILITY_DIMENSIONS.has(parsed.data.abilityKey)) {
      const matchingAbilities = await db.select({ id: careerAbilities.id })
        .from(careerAbilities)
        .where(and(
          eq(careerAbilities.userId, authorization.studentId),
          eq(careerAbilities.code, parsed.data.abilityKey),
        ))
        .limit(1);
      if (!matchingAbilities[0]) {
        return NextResponse.json({ error: 'INVALID_ABILITY_KEY' }, { status: 400 });
      }
    }

    const id = crypto.randomUUID();
    const primaryGoal = (await db.select({
      id: careerGoals.id,
      occupationCode: careerGoals.occupationCode,
    }).from(careerGoals).where(and(
      eq(careerGoals.userId, authorization.studentId),
      eq(careerGoals.isPrimary, true),
      eq(careerGoals.status, 'active'),
    )).limit(1))[0];

    await db.insert(careerTasks).values({
      id,
      userId: authorization.studentId,
      goalId: primaryGoal?.id ?? null,
      occupationCode: primaryGoal?.occupationCode ?? null,
      abilityCode: parsed.data.abilityKey,
      title: parsed.data.title,
      reason: parsed.data.reason,
      completionCriteria: parsed.data.completionCriteria,
      category: 'learn',
      status: 'todo',
      dueAt,
      assignedBy: authorization.actorUserId,
    });

    return NextResponse.json({
      ok: true,
      task: {
        id,
        title: parsed.data.title,
        abilityKey: parsed.data.abilityKey,
        dueAt: dueAt.toISOString(),
        status: 'todo',
      },
    }, { status: 201 });
  } catch (error) {
    logger.error('teacher.task_creation_failed', { error });
    return NextResponse.json({ error: 'TASK_CREATE_FAILED' }, { status: 500 });
  }
}
