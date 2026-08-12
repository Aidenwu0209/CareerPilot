import { NextRequest, NextResponse } from 'next/server';
import { calculateAndPersistCareerMatch, getCareerMatch } from '@/lib/career/service';
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

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json().catch(() => ({})) as { occupationCode?: unknown };
    const occupationCode = typeof body.occupationCode === 'string' && body.occupationCode.trim()
      ? body.occupationCode.trim()
      : undefined;
    return NextResponse.json({ match: await calculateAndPersistCareerMatch(user.id, occupationCode) });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/matches');
  }
}
