import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { encode } from 'next-auth/jwt';
import { verifyOtp } from '@/lib/auth/email-otp';
import { refreshUserClaims } from '@/lib/auth/session-claims';

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

  // ── Create session ──

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error('AUTH_SECRET is not configured');
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = isProduction
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const maxAge = 30 * 24 * 60 * 60; // 30 days (matches NextAuth default)
  const now = Math.floor(Date.now() / 1000);

  // Fetch fresh claims (platformRole, status) for the JWT
  const claims = await refreshUserClaims(result.userId);

  const sessionToken = await encode({
    token: {
      userId: result.userId,
      name: result.name || undefined,
      email: result.email,
      platformRole: claims?.platformRole,
      status: claims?.status,
      lastRefreshAt: now,
      sub: result.userId,
      iat: now,
      exp: now + maxAge,
      jti: crypto.randomUUID(),
    },
    secret,
    maxAge,
    salt: cookieName,
  });

  // Set the session cookie
  const cookieStore = await cookies();
  cookieStore.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    secure: isProduction,
  });

  return NextResponse.json({
    ok: true,
    userId: result.userId,
  });
}
