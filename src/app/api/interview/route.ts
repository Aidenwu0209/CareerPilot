import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { dbReady } from '@/lib/db';
import {
  MAX_ARRAY_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  sanitizedError,
} from '@/lib/validation/input-limits';
import { checkRateLimit, RATE_LIMIT_POLICIES, rateLimitKey, rateLimitedResponse } from '@/lib/rate-limit/rate-limit';

async function interviewLimit(userId: string) {
  const result = await checkRateLimit(rateLimitKey('interview-api', 'user', userId), RATE_LIMIT_POLICIES.interviewApi);
  return result.allowed ? null : rateLimitedResponse(result.retryAfter);
}

export async function GET(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const limited = await interviewLimit(user.id);
  if (limited) return limited;

  const sessions = await interviewRepository.findSessionsByUserId(user.id);
  return NextResponse.json(sessions);
}

export async function POST(request: NextRequest) {
  await dbReady;
  const fingerprint = getUserIdFromRequest(request);
  const user = await resolveUser(fingerprint);
  if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const limited = await interviewLimit(user.id);
  if (limited) return limited;

  const body = await request.json();
  const { jobDescription, jobTitle, resumeId, interviewers } = body;

  if (!jobDescription || !jobTitle || !interviewers?.length) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Input size limits — reject before any DB writes
  if (typeof jobDescription === 'string' && jobDescription.length > MAX_PROMPT_LENGTH) {
    return sanitizedError(`Job description too long (max ${MAX_PROMPT_LENGTH} characters)`);
  }
  if (typeof jobTitle === 'string' && jobTitle.length > MAX_SHORT_TEXT_LENGTH) {
    return sanitizedError(`Job title too long (max ${MAX_SHORT_TEXT_LENGTH} characters)`);
  }
  if (Array.isArray(interviewers) && interviewers.length > MAX_ARRAY_LENGTH) {
    return sanitizedError(`Too many interviewers (max ${MAX_ARRAY_LENGTH})`);
  }

  // Verify resumeId belongs to the current user
  if (resumeId) {
    const resume = await resumeRepository.findById(resumeId);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const session = await interviewRepository.createSession({
    userId: user.id,
    resumeId: resumeId || undefined,
    jobDescription,
    jobTitle,
    selectedInterviewers: interviewers,
  });

  for (let i = 0; i < interviewers.length; i++) {
    await interviewRepository.createRound({
      sessionId: session!.id,
      interviewerType: interviewers[i].type,
      interviewerConfig: interviewers[i],
      sortOrder: i,
    });
  }

  const rounds = await interviewRepository.findRoundsBySessionId(session!.id);
  return NextResponse.json({ session, rounds }, { status: 201 });
}
