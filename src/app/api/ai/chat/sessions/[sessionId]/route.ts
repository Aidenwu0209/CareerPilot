import { NextRequest, NextResponse } from 'next/server';
import { resolveUser, getUserIdFromRequest } from '@/lib/auth/helpers';
import { chatRepository } from '@/lib/db/repositories/chat.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { logger } from '@/lib/observability/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

    const { sessionId } = await params;

    const session = await chatRepository.findSession(sessionId);
    if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // Verify session's resume belongs to the current user
    const resume = await resumeRepository.findById(session.resumeId);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 50) : 20;

    const { messages, hasMore, nextCursor } = await chatRepository.findPaginatedMessages(sessionId, { cursor, limit });

    return NextResponse.json({ session, messages, hasMore, nextCursor });
  } catch (error) {
    logger.error('ai.chat_session_get_failed', { error });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const fingerprint = getUserIdFromRequest(request);
    const user = await resolveUser(fingerprint);
    if (!user) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

    const { sessionId } = await params;

    const session = await chatRepository.findSession(sessionId);
    if (!session) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // Verify session's resume belongs to the current user
    const resume = await resumeRepository.findById(session.resumeId);
    if (!resume || resume.userId !== user.id) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    await chatRepository.deleteSession(sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('ai.chat_session_delete_failed', { error });
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
