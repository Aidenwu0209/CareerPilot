import { NextRequest, NextResponse } from 'next/server';
import { getCareerMatch } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const occupationCode = request.nextUrl.searchParams.get('occupationCode') ?? undefined;
    return NextResponse.json({ match: await getCareerMatch(user.id, occupationCode) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/matches');
  }
}
