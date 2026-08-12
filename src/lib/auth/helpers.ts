import { auth } from './config';
import { config } from '@/lib/config';
import { dbReady } from '@/lib/db';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { isDemoFingerprint } from './demo-mode';
import { FINGERPRINT_COOKIE_NAME } from './providers/fingerprint';

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id || null;
}

export async function resolveUser(fingerprint?: string | null) {
  // Ensure DB tables exist before any query
  await dbReady;

  const session = await auth();
  if (session?.user?.id) {

    // Session identity is stable and must never fall back to an email lookup,
    // which could bind a legacy fingerprint account to the wrong session.
    return userRepository.findById(session.user.id);
  }

  // Demo identities are fixed, pre-seeded accounts. Product mode never reads a
  // browser fingerprint and demo mode never creates a user from one.
  if (!config.runtime.demoMode || !isDemoFingerprint(fingerprint)) return null;
  return userRepository.findByFingerprint(fingerprint);
}

export function getUserIdFromRequest(request: Request): string | null {
  if (!config.runtime.demoMode) return null;

  const headerFingerprint = request.headers.get('x-fingerprint');
  if (isDemoFingerprint(headerFingerprint)) return headerFingerprint;

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
    const fingerprint = decodeURIComponent(encodedValue) || null;
    return isDemoFingerprint(fingerprint) ? fingerprint : null;
  } catch {
    return null;
  }
}
