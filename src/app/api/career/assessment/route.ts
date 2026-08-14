import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getCareerSelfAssessment, saveCareerSelfAssessment } from '@/lib/career/self-assessment-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    return NextResponse.json({ assessment: await getCareerSelfAssessment(user.id) });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/assessment');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json() as { answers?: Record<string, number>; complete?: boolean };
    return NextResponse.json({
      assessment: await saveCareerSelfAssessment(user.id, body.answers ?? {}, body.complete === true),
    });
  } catch (error) {
    return careerApiError(error, 'PUT /api/career/assessment');
  }
}
