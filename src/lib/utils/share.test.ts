import { describe, expect, it } from 'vitest';
import {
  generateShareToken,
  hashPassword,
  isLegacyPasswordHash,
  verifyPassword,
} from './share';

describe('share security utilities', () => {
  it('generates high-entropy URL-safe tokens', () => {
    const first = generateShareToken();
    const second = generateShareToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it('uses a unique salt and verifies the correct password', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^pbkdf2-sha256\$210000\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse battery staple', first)).toBe(true);
    expect(await verifyPassword('wrong password', first)).toBe(false);
  });

  it('verifies legacy SHA-256 hashes for transparent migration', async () => {
    const legacy = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
    expect(isLegacyPasswordHash(legacy)).toBe(true);
    expect(await verifyPassword('password', legacy)).toBe(true);
    expect(await verifyPassword('not-password', legacy)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('password', 'pbkdf2-sha256$2$bad$bad')).toBe(false);
    expect(await verifyPassword('password', 'plain-text')).toBe(false);
  });
});
