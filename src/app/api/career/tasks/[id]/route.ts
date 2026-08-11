import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateCareerTaskStatus } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

const updateTaskSchema = z.object({ status: z.enum(['todo', 'in_progress', 'completed', 'cancelled']) });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const parsed = updateTaskSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 });
    const { id } = await params;
    const task = await updateCareerTaskStatus(user.id, decodeURIComponent(id), parsed.data.status);
    if (!task) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    return careerApiError(error, 'PATCH /api/career/tasks/[id]');
  }
}
