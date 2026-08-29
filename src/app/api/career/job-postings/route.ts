import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { listJobRecommendations } from '@/lib/career/job-posting-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const query = new URL(request.url).searchParams;
    const sort = query.get('sort');
    return NextResponse.json({ jobs: await listJobRecommendations(user.id, {
      industry: query.get('industry') || undefined,
      sort: sort === 'salary' || sort === 'skills' ? sort : 'match',
    }) });
  } catch (error) { return careerApiError(error, 'GET /api/career/job-postings'); }
}
