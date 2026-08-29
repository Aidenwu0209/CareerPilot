import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getGrowthProgress } from '@/lib/career/growth-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const timeZone = new URL(request.url).searchParams.get('timeZone') ?? 'UTC';
    return NextResponse.json(await getGrowthProgress(user.id, new Date(), timeZone));
  } catch (error) {
    return careerApiError(error, 'GET /api/career/growth-progress');
  }
}
