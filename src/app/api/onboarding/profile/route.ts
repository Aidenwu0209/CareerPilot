import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  completeOnboarding,
  validateOnboardingProfile,
} from '@/lib/auth/onboarding';
import { createAuthSessionCookie } from '@/lib/auth/session-cookie';
import { logger } from '@/lib/observability/logger';

export async function POST(request: NextRequest) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const record = body as Record<string, unknown> | null;
  const profile = validateOnboardingProfile(record);
  if (!profile.success) {
    return NextResponse.json(
      { error: 'INVALID_PROFILE', fields: profile.fields },
      { status: 400 },
    );
  }
  if (record?.termsAccepted !== true || record?.privacyAccepted !== true) {
    return NextResponse.json({ error: 'CONSENT_REQUIRED' }, { status: 400 });
  }

  try {
    const userId = ctx.context.actor.userId;
    await completeOnboarding({
      userId,
      profile: profile.data,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
    const sessionCookie = await createAuthSessionCookie(userId);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      sessionCookie.name,
      sessionCookie.value,
      sessionCookie.options,
    );
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === 'ONBOARDING_NOT_REQUIRED') {
      try {
        const sessionCookie = await createAuthSessionCookie(ctx.context.actor.userId);
        const response = NextResponse.json({ ok: true, alreadyCompleted: true });
        response.cookies.set(
          sessionCookie.name,
          sessionCookie.value,
          sessionCookie.options,
        );
        return response;
      } catch (sessionError) {
        logger.error('auth.onboarding_session_refresh_failed', { error: sessionError });
      }
    }
    return NextResponse.json({ error: 'ONBOARDING_FAILED' }, { status: 500 });
  }
}
