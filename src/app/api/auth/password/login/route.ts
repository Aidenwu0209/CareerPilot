import { NextResponse } from 'next/server';
import { loginWithPassword } from '@/lib/auth/password-auth';
import { createAuthSessionCookie } from '@/lib/auth/session-cookie';
import { getClientIP } from '@/lib/rate-limit/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const result = await loginWithPassword(
    { email: body.email, password: body.password },
    getClientIP(request),
  );
  if (!result.success) {
    const status = result.error === 'RATE_LIMITED'
      ? 429
      : result.error === 'ACCOUNT_SUSPENDED'
        ? 403
        : result.error === 'INVALID_CREDENTIALS'
          ? 401
          : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const sessionCookie = await createAuthSessionCookie(result.userId);
  const response = NextResponse.json({
    ok: true,
    onboardingRequired: sessionCookie.claims.onboardingRequired,
  });
  response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
