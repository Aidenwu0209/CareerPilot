import { NextRequest, NextResponse } from 'next/server';
import { getOccupationByCode } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const { code } = await params;
    const occupation = await getOccupationByCode(decodeURIComponent(code));
    if (!occupation) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ occupation });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/occupations/[code]');
  }
}
