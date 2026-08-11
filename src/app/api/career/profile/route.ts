import { NextRequest, NextResponse } from 'next/server';
import { getCareerProfile } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ profile: await getCareerProfile(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/profile');
  }
}
