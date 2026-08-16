import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { chatRepository } from '@/lib/db/repositories/chat.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { logger } from '@/lib/observability/logger';

export async function GET(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

    const resumeId = request.nextUrl.searchParams.get('resumeId');
    if (!resumeId) return NextResponse.json({ error: 'RESUME_ID_REQUIRED' }, { status: 400 });

    const resume = await resumeRepository.findById(resumeId);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const sessions = await chatRepository.findSessionsByResumeId(resumeId);
    return NextResponse.json({ sessions });
  } catch (error) {
    logger.error('ai.chat_sessions_list_failed', { error });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

    const { resumeId } = await request.json();
    if (!resumeId) return NextResponse.json({ error: 'RESUME_ID_REQUIRED' }, { status: 400 });

    const resume = await resumeRepository.findById(resumeId);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const session = await chatRepository.createSession({ resumeId });
    return NextResponse.json({ session });
  } catch (error) {
    logger.error('ai.chat_session_create_failed', { error });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
