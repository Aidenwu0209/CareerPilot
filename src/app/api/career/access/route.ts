import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getCareerAccess, unlockCareerFeature, type CareerPaidFeature } from '@/lib/career/growth-service';

const FEATURES = new Set<CareerPaidFeature>(['assessment_report', 'match_heatmap', 'full_path']);

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json(await getCareerAccess(user.id));
  } catch (error) {
    return careerApiError(error, 'GET /api/career/access');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json() as { feature?: CareerPaidFeature };
    if (!body.feature || !FEATURES.has(body.feature)) return NextResponse.json({ error: 'INVALID_FEATURE' }, { status: 400 });
    return NextResponse.json(await unlockCareerFeature(user.id, body.feature));
  } catch (error) {
    return careerApiError(error, 'POST /api/career/access');
  }
}
