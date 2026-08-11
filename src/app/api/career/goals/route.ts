import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listCareerGoals, upsertCareerGoal } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

const goalSchema = z.object({
  occupationCode: z.string().trim().min(1).max(64),
  isPrimary: z.boolean().optional(),
  targetDate: z.string().max(40).nullable().optional(),
  rationale: z.string().max(2000).optional(),
  preferences: z.object({
    industries: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    cities: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    organizationTypes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  }).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ goals: await listCareerGoals(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/goals');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const parsed = goalSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ goal: await upsertCareerGoal(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/goals');
  }
}
