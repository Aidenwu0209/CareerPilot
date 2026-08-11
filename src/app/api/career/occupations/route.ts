import { NextRequest, NextResponse } from 'next/server';
import { listOccupations } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const query = request.nextUrl.searchParams.get('q') ?? undefined;
    return NextResponse.json({ occupations: await listOccupations(query) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/occupations');
  }
}
