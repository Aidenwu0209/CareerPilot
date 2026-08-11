import { NextRequest, NextResponse } from 'next/server';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { shareRepository } from '@/lib/db/repositories/share.repository';
import { hashPassword, isLegacyPasswordHash, verifyPassword } from '@/lib/utils/share';
import {
  checkRateLimit,
  rateLimitedResponse,
  rateLimitKey,
  RATE_LIMIT_POLICIES,
} from '@/lib/rate-limit/rate-limit';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  return serveSharedResume(token, null);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const clientAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const limit = await checkRateLimit(
    rateLimitKey('share-password', 'token-ip', `${token}:${clientAddress}`),
    RATE_LIMIT_POLICIES.sharePassword,
  );
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 256) {
    return NextResponse.json({ error: 'Invalid password', passwordRequired: true }, { status: 401 });
  }
  return serveSharedResume(token, body.password);
}

async function serveSharedResume(token: string, password: string | null) {
  try {
    // 1. Try new resume_shares table first
    const share = await shareRepository.findByToken(token);
    if (share) {
      if (!share.isActive) {
        return NextResponse.json({ error: 'This share link has been disabled' }, { status: 403 });
      }

      if (share.password) {
        if (!password) {
          return NextResponse.json(
            { error: 'Password required', passwordRequired: true },
            { status: 401 }
          );
        }
        if (!(await verifyPassword(password, share.password))) {
          return NextResponse.json(
            { error: 'Invalid password', passwordRequired: true },
            { status: 401 }
          );
        }
        if (isLegacyPasswordHash(share.password)) {
          await shareRepository.update(share.id, { password: await hashPassword(password) });
        }
      }

      await shareRepository.incrementViewCount(share.id);

      const resume = await resumeRepository.findById(share.resumeId);
      if (!resume) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const { userId, sharePassword, ...publicResume } = resume;
      return NextResponse.json(publicResume, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    // 2. Fallback to legacy resumes.shareToken
    const resume = await resumeRepository.findByShareToken(token);
    if (!resume) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!resume.isPublic) {
      return NextResponse.json({ error: 'This resume is not shared' }, { status: 403 });
    }

    if (resume.sharePassword) {
      if (!password) {
        return NextResponse.json(
          { error: 'Password required', passwordRequired: true },
          { status: 401 }
        );
      }
      if (!(await verifyPassword(password, resume.sharePassword))) {
        return NextResponse.json(
          { error: 'Invalid password', passwordRequired: true },
          { status: 401 }
        );
      }
      if (isLegacyPasswordHash(resume.sharePassword)) {
        await resumeRepository.updateShareSettings(resume.id, {
          isPublic: true,
          shareToken: token,
          sharePassword: await hashPassword(password),
        });
      }
    }

    await resumeRepository.incrementViewCount(resume.id);

    const { userId, sharePassword, ...publicResume } = resume;
    return NextResponse.json(publicResume, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('/api/share/[token] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
