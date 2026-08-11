import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createCareerTask, listCareerTasks, updateCareerTaskStatus } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

const statusSchema = z.enum(['todo', 'in_progress', 'completed', 'cancelled']);
const createTaskSchema = z.object({
  goalId: z.string().trim().min(1).max(128).nullable().optional(),
  occupationCode: z.string().trim().min(1).max(64).nullable().optional(),
  abilityCode: z.string().trim().min(1).max(100).nullable().optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(4000).optional(),
  reason: z.string().max(4000).optional(),
  completionCriteria: z.string().max(4000).optional(),
  category: z.enum(['explore', 'learn', 'practice', 'portfolio', 'application']).optional(),
  dueAt: z.string().max(40).nullable().optional(),
});
const updateTaskSchema = z.object({ id: z.string().trim().min(1).max(128), status: statusSchema });

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ tasks: await listCareerTasks(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/tasks');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const parsed = createTaskSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 });
    return NextResponse.json({ task: await createCareerTask(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/tasks');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const parsed = updateTaskSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 });
    const task = await updateCareerTaskStatus(user.id, parsed.data.id, parsed.data.status);
    if (!task) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    return careerApiError(error, 'PATCH /api/career/tasks');
  }
}
