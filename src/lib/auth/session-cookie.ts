import { encode } from 'next-auth/jwt';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { refreshUserClaims } from './session-claims';

export const AUTH_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function getAuthSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

export function getAuthSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: AUTH_SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function createAuthSessionCookie(userId: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET_NOT_CONFIGURED');

  const [user, claims] = await Promise.all([
    userRepository.findById(userId),
    refreshUserClaims(userId),
  ]);
  if (!user || !claims) throw new Error('SESSION_USER_NOT_FOUND');

  const name = getAuthSessionCookieName();
  const now = Math.floor(Date.now() / 1000);
  const value = await encode({
    token: {
      userId: user.id,
      name: user.name ?? undefined,
      email: user.email ?? undefined,
      picture: user.avatarUrl ?? undefined,
      platformRole: claims.platformRole,
      status: claims.status,
      onboardingRequired: claims.onboardingRequired,
      authType: claims.authType,
      lastRefreshAt: now,
      sub: user.id,
      iat: now,
      exp: now + AUTH_SESSION_MAX_AGE,
      jti: crypto.randomUUID(),
    },
    secret,
    maxAge: AUTH_SESSION_MAX_AGE,
    salt: name,
  });

  return {
    name,
    value,
    options: getAuthSessionCookieOptions(),
    claims,
  };
}
