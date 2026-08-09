import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * US-016 tests: resolveUser and getUserIdFromRequest hardening.
 *
 * Verifies that:
 * - In production, x-fingerprint header is never trusted for auth
 * - In production, resolveUser never creates users from fingerprint
 * - getUserIdFromRequest returns null in production regardless of headers
 */

// Mock dependencies
vi.mock('./config', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  config: { auth: { enabled: false } },
}));

vi.mock('@/lib/db', () => ({
  dbReady: Promise.resolve(),
}));

const mockUpsertByFingerprint = vi.fn();
vi.mock('@/lib/db/repositories/user.repository', () => ({
  userRepository: {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    upsertByFingerprint: mockUpsertByFingerprint,
  },
}));

describe('getUserIdFromRequest — production hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    mockUpsertByFingerprint.mockClear();
  });

  it('returns null in production regardless of x-fingerprint header', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume', {
      headers: { 'x-fingerprint': 'forged-fp-123' },
    });

    expect(getUserIdFromRequest(request)).toBeNull();
  });

  it('returns null in production regardless of fingerprint cookie', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume', {
      headers: { cookie: 'jade_fingerprint=forged-cookie-fp' },
    });

    expect(getUserIdFromRequest(request)).toBeNull();
  });

  it('returns fingerprint in development when header is present', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume', {
      headers: { 'x-fingerprint': 'dev-fp-456' },
    });

    expect(getUserIdFromRequest(request)).toBe('dev-fp-456');
  });

  it('falls back to the development fingerprint cookie when the header is absent', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume', {
      headers: { cookie: 'theme=dark; jade_fingerprint=cookie-fp-789' },
    });
    expect(getUserIdFromRequest(request)).toBe('cookie-fp-789');
  });

  it('prefers the explicit development header over the cookie', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume', {
      headers: {
        'x-fingerprint': 'header-fp',
        cookie: 'jade_fingerprint=cookie-fp',
      },
    });
    expect(getUserIdFromRequest(request)).toBe('header-fp');
  });

  it('returns null in development when neither header nor cookie is present', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    const { getUserIdFromRequest } = await import('./helpers');

    const request = new Request('http://localhost/api/resume');
    expect(getUserIdFromRequest(request)).toBeNull();
  });
});

describe('resolveUser — production rejects fingerprint', () => {
  beforeEach(() => {
    vi.resetModules();
    mockUpsertByFingerprint.mockClear();
  });

  it('returns null in production even with fingerprint (no user creation)', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { resolveUser } = await import('./helpers');

    const user = await resolveUser('forged-fingerprint');
    expect(user).toBeNull();
    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('returns null in production without fingerprint', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { resolveUser } = await import('./helpers');

    const user = await resolveUser(null);
    expect(user).toBeNull();
    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('returns null in production even when fingerprint is empty string', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { resolveUser } = await import('./helpers');

    const user = await resolveUser('');
    expect(user).toBeNull();
    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });
});

// Cleanup
afterAll(() => {
  Object.assign(process.env, { NODE_ENV: 'test' });
});
