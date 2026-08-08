export const FINGERPRINT_STORAGE_KEY = 'jade_fingerprint';
export const FINGERPRINT_COOKIE_NAME = 'jade_fingerprint';

const FINGERPRINT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Keep the development-only fingerprint available to Server Components.
 * API requests continue to send the same value through X-Fingerprint.
 */
export function buildFingerprintCookie(fingerprint: string, secure = false): string {
  const parts = [
    `${FINGERPRINT_COOKIE_NAME}=${encodeURIComponent(fingerprint)}`,
    'Path=/',
    `Max-Age=${FINGERPRINT_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
  ];

  if (secure) parts.push('Secure');
  return parts.join('; ');
}
