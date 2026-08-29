import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { createJobSubscription, listJobSubscriptions } from '@/lib/career/growth-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ subscriptions: await listJobSubscriptions(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/job-subscriptions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json() as { keywords?: string; city?: string; frequency?: 'daily' | 'weekly' };
    if (!body.keywords) return NextResponse.json({ error: 'KEYWORDS_REQUIRED' }, { status: 400 });
    return NextResponse.json({ subscriptions: await createJobSubscription(user.id, { ...body, keywords: body.keywords }) }, { status: 201 });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/job-subscriptions');
  }
}
