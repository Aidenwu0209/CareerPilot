import { NextResponse } from 'next/server';
import { registerPasswordAccount } from '@/lib/auth/password-auth';
import { createAuthSessionCookie } from '@/lib/auth/session-cookie';
import { getClientIP } from '@/lib/rate-limit/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  if (
    typeof body.name !== 'string'
    || typeof body.email !== 'string'
    || typeof body.password !== 'string'
  ) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const result = await registerPasswordAccount(
    { name: body.name, email: body.email, password: body.password },
    getClientIP(request),
  );
  if (!result.success) {
    const status = result.error === 'RATE_LIMITED'
      ? 429
      : result.error === 'EMAIL_EXISTS'
        ? 409
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const sessionCookie = await createAuthSessionCookie(result.userId);
  const response = NextResponse.json({
    ok: true,
    onboardingRequired: sessionCookie.claims.onboardingRequired,
  }, { status: 201 });
  response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
