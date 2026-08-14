import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { dbReady } from '@/lib/db';
import { checkRateLimit, RATE_LIMIT_POLICIES, rateLimitKey, rateLimitedResponse } from '@/lib/rate-limit/rate-limit';

export async function GET(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const limit = await checkRateLimit(rateLimitKey('interview-api', 'user', user.id), RATE_LIMIT_POLICIES.interviewApi);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  const reportsWithSessions = await interviewRepository.findReportsByUserId(user.id);

  const sessions = reportsWithSessions.map(({ report, session }) => ({
    id: session.id,
    jobTitle: session.jobTitle,
    overallScore: report.overallScore,
    dimensionScores: report.dimensionScores,
    createdAt: session.createdAt,
  }));

  return NextResponse.json({ sessions });
}
