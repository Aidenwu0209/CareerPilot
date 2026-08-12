import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  config: { runtime: { demoMode: false } },
  findById: vi.fn(),
  findByFingerprint: vi.fn(),
}));

vi.mock('./config', () => ({ auth: mocks.auth }));
vi.mock('@/lib/config', () => ({ config: mocks.config }));
vi.mock('@/lib/db', () => ({ dbReady: Promise.resolve() }));
vi.mock('@/lib/db/repositories/user.repository', () => ({
  userRepository: {
    findById: mocks.findById,
    findByFingerprint: mocks.findByFingerprint,
  },
}));

import { getUserIdFromRequest, resolveUser } from './helpers';

describe('product and demo identity resolution', () => {
  beforeEach(() => {
    mocks.config.runtime.demoMode = false;
    mocks.auth.mockReset().mockResolvedValue(null);
    mocks.findById.mockReset();
    mocks.findByFingerprint.mockReset();
  });

  it('ignores fingerprint headers and cookies in product mode', () => {
    const request = new Request('http://localhost/api/resume', {
      headers: {
        'x-fingerprint': 'demo-fingerprint',
        cookie: 'jade_fingerprint=demo-fingerprint',
      },
    });
    expect(getUserIdFromRequest(request)).toBeNull();
  });

  it('resolves a product account only by the stable session user id', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'session-user', email: 'email@test.com' } });
    mocks.findById.mockResolvedValue({ id: 'session-user' });
    await expect(resolveUser()).resolves.toEqual({ id: 'session-user' });
    expect(mocks.findById).toHaveBeenCalledWith('session-user');
    expect(mocks.findByFingerprint).not.toHaveBeenCalled();
  });

  it('accepts only fixed seeded identities in explicit demo mode', async () => {
    mocks.config.runtime.demoMode = true;
    mocks.findByFingerprint.mockResolvedValue({ id: 'demo-student' });

    expect(getUserIdFromRequest(new Request('http://localhost', {
      headers: { 'x-fingerprint': 'demo-fingerprint' },
    }))).toBe('demo-fingerprint');
    expect(getUserIdFromRequest(new Request('http://localhost', {
      headers: { 'x-fingerprint': 'random-browser-id' },
    }))).toBeNull();
    await expect(resolveUser('demo-fingerprint')).resolves.toEqual({ id: 'demo-student' });
    await expect(resolveUser('random-browser-id')).resolves.toBeNull();
    expect(mocks.findByFingerprint).toHaveBeenCalledTimes(1);
  });
});
