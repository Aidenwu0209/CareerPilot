import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/auth/email-otp';
import { createAuthSessionCookie } from '@/lib/auth/session-cookie';
import { logger } from '@/lib/observability/logger';

/**
 * POST /api/auth/otp/verify
 *
 * Request body: { email: string, code: string }
 *
 * Verifies the OTP code against the stored hash.
 * On success, creates a session cookie and returns user identity.
 * On failure, returns a stable error that does not leak whether the email is registered.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const email = body?.email;
  const code = body?.code;

  if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const result = await verifyOtp(email, code);

  if (!result.success || !result.userId) {
    const status = result.error === 'RATE_LIMITED' ? 429 : 400;
    return NextResponse.json({ error: result.error || 'INVALID_CODE' }, { status });
  }

  try {
    const sessionCookie = await createAuthSessionCookie(result.userId);
    const response = NextResponse.json({
      ok: true,
      userId: result.userId,
      onboardingRequired: sessionCookie.claims.onboardingRequired,
    });
    response.cookies.set(
      sessionCookie.name,
      sessionCookie.value,
      sessionCookie.options,
    );
    return response;
  } catch (error) {
    logger.error('auth.otp_session_creation_failed', { error });
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }
}
