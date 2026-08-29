import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getAssessmentHistory } from '@/lib/career/assessment-results';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ history: await getAssessmentHistory(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/assessment/history');
  }
}
