import { NextRequest, NextResponse } from 'next/server';
import { calculateAndPersistCareerMatch, getCareerMatch } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getCareerAccess } from '@/lib/career/growth-service';

async function matchResponse(userId: string, match: Awaited<ReturnType<typeof getCareerMatch>>) {
  const access = await getCareerAccess(userId);
  const locked = !access.features.match_heatmap.unlocked;
  return {
    match: locked && match ? { ...match, dimensionBreakdown: [], strengths: [], priorityGaps: [], changeSummary: null } : match,
    preview: locked && match ? {
      strengths: (match.strengths ?? []).slice(0, 3).map((item) => ({ abilityCode: item.abilityCode, abilityName: item.abilityName })),
      gaps: (match.priorityGaps ?? []).slice(0, 3).map((item) => ({ abilityCode: item.abilityCode, abilityName: item.abilityName })),
    } : null,
    access,
    locked,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const occupationCode = request.nextUrl.searchParams.get('occupationCode') ?? undefined;
    return NextResponse.json(await matchResponse(user.id, await getCareerMatch(user.id, occupationCode)));
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
    return NextResponse.json(await matchResponse(user.id, await calculateAndPersistCareerMatch(user.id, occupationCode)));
  } catch (error) {
    return careerApiError(error, 'POST /api/career/matches');
  }
}
