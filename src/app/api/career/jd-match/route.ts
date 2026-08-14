import { NextRequest, NextResponse } from 'next/server';
import { matchJobDescription } from '@/lib/career/service';
import { careerApiError, resolveCareerApiUser, unauthorizedCareerResponse } from '@/lib/career/http';

export async function POST(request: NextRequest) {
  try {
    const user = await resolveCareerApiUser(request);
    if (!user) return unauthorizedCareerResponse();
    const body = await request.json() as { jobDescription?: string };
    return NextResponse.json({ result: await matchJobDescription(user.id, body.jobDescription ?? '') });
  } catch (error) {
    return careerApiError(error, 'POST /api/career/jd-match');
  }
}
