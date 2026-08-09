import { auth } from './config';
import { config } from '@/lib/config';
import { dbReady } from '@/lib/db';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { FINGERPRINT_COOKIE_NAME } from './providers/fingerprint';

const isProduction = process.env.NODE_ENV === 'production';

export async function getCurrentUserId(): Promise<string | null> {
  if (config.auth.enabled) {
    const session = await auth();
    return session?.user?.id || null;
  }
  // In fingerprint mode, userId is resolved from the request header
  return null;
}

export async function resolveUser(fingerprint?: string | null) {
  // Ensure DB tables exist before any query
  await dbReady;

  if (config.auth.enabled) {
    const session = await auth();
    if (!session?.user?.id) return null;

    // User was created during sign-in (jwt callback), just look up
    let user = await userRepository.findById(session.user.id);

    // Fallback: ID may differ if token was issued before DB creation
    if (!user && session.user.email) {
      user = await userRepository.findByEmail(session.user.email);
    }

    return user;
  }

  // Fingerprint-based auth is dev-only.
  // In production, never create or resolve users from x-fingerprint header.
  if (isProduction || !fingerprint) return null;
  return userRepository.upsertByFingerprint(fingerprint);
}

export function getUserIdFromRequest(request: Request): string | null {
  // In production, the x-fingerprint header is never trusted for auth.
  if (isProduction) return null;

  const headerFingerprint = request.headers.get('x-fingerprint');
  if (headerFingerprint) return headerFingerprint;

  // Browser requests do not all add the development-only header. The
  // fingerprint hook persists the same value as a SameSite cookie, so use it
  // as a fallback to avoid first-render races after identity initialization.
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FINGERPRINT_COOKIE_NAME}=`));
  if (!cookie) return null;

  const encodedValue = cookie.slice(FINGERPRINT_COOKIE_NAME.length + 1);
  try {
    return decodeURIComponent(encodedValue) || null;
  } catch {
    return null;
  }
}
