import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { checkIn } from '@/lib/career/growth-service';

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json().catch(() => ({})) as { timeZone?: string; taskIdsCompleted?: string[] };
    return NextResponse.json(await checkIn(user.id, body));
  } catch (error) {
    return careerApiError(error, 'POST /api/career/check-in');
  }
}
