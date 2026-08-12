import { NextRequest, NextResponse } from 'next/server';
import { listOccupationPage } from '@/lib/career/service';
import type { MajorOccupationRelationType, OccupationRelationType } from '@/types/career';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const params = request.nextUrl.searchParams;
    const limit = params.get('limit') ? Number(params.get('limit')) : undefined;
    const offset = params.get('offset') ? Number(params.get('offset')) : undefined;
    const relevanceType = params.get('relevanceType') ?? undefined;
    const relationType = params.get('relationType') ?? undefined;
    if ((limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))
      || (offset !== undefined && (!Number.isInteger(offset) || offset < 0))) {
      return NextResponse.json({ error: 'INVALID_PAGINATION' }, { status: 400 });
    }
    if (relevanceType && !['primary', 'adjacent', 'cross_major', 'stretch'].includes(relevanceType)) {
      return NextResponse.json({ error: 'INVALID_RELEVANCE_TYPE' }, { status: 400 });
    }
    if (relationType && !['progresses_to', 'transfers_to', 'related_to'].includes(relationType)) {
      return NextResponse.json({ error: 'INVALID_RELATION_TYPE' }, { status: 400 });
    }
    const page = await listOccupationPage({
      query: params.get('q') ?? undefined,
      limit,
      offset,
      collegeCode: params.get('collegeCode') ?? undefined,
      majorCode: params.get('majorCode') ?? undefined,
      jobFamily: params.get('jobFamily') ?? undefined,
      industry: params.get('industry') ?? undefined,
      city: params.get('city') ?? undefined,
      educationLevel: params.get('educationLevel') ?? undefined,
      relevanceType: relevanceType as MajorOccupationRelationType | undefined,
      relationType: relationType as OccupationRelationType | undefined,
    });
    return NextResponse.json({ ...page, occupations: page.items });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/occupations');
  }
}
