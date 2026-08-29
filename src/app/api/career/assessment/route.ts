import { NextRequest, NextResponse } from 'next/server';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';
import { getCareerSelfAssessment, saveCareerSelfAssessment } from '@/lib/career/self-assessment-service';
import { getCareerAccess } from '@/lib/career/growth-service';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const [assessment, access] = await Promise.all([getCareerSelfAssessment(user.id), getCareerAccess(user.id)]);
    return NextResponse.json({ assessment, access });
  } catch (error) {
    return careerApiError(error, 'GET /api/career/assessment');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json() as { answers?: Record<string, number>; complete?: boolean };
    if (body.complete === true) {
      const access = await getCareerAccess(user.id);
      if (!access.features.assessment_report.unlocked) {
        return NextResponse.json({ error: 'CAREER_FEATURE_LOCKED', feature: 'assessment_report', access }, { status: 402 });
      }
    }
    return NextResponse.json({
      assessment: await saveCareerSelfAssessment(user.id, body.answers ?? {}, body.complete === true),
    });
  } catch (error) {
    return careerApiError(error, 'PUT /api/career/assessment');
  }
}
