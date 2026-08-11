import { describe, expect, it } from 'vitest';
import {
  buildFingerprintCookie,
  FINGERPRINT_COOKIE_NAME,
  FINGERPRINT_STORAGE_KEY,
} from './fingerprint';

describe('fingerprint persistence', () => {
  it('uses the same key for local storage and the server-readable cookie', () => {
    expect(FINGERPRINT_COOKIE_NAME).toBe('jade_fingerprint');
    expect(FINGERPRINT_STORAGE_KEY).toBe(FINGERPRINT_COOKIE_NAME);
  });

  it('encodes the fingerprint and applies safe cookie attributes', () => {
    expect(buildFingerprintCookie('visitor/id value')).toBe(
      'jade_fingerprint=visitor%2Fid%20value; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });

  it('marks the cookie secure on HTTPS', () => {
    expect(buildFingerprintCookie('visitor-id', true)).toContain('; Secure');
  });
});
