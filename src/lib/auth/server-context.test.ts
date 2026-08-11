import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { auth: { enabled: false } },
  cookies: vi.fn(),
  resolveContext: vi.fn(),
}));

vi.mock('@/lib/config', () => ({ config: mocks.config }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('./context', () => ({ resolveContext: mocks.resolveContext }));

import { resolveServerContext } from './server-context';

describe('resolveServerContext', () => {
  beforeEach(() => {
    mocks.config.auth.enabled = false;
    mocks.cookies.mockReset();
    mocks.resolveContext.mockReset();
  });

  it('passes the development fingerprint cookie to context resolution', async () => {
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'browser-fingerprint' }),
    });
    mocks.resolveContext.mockResolvedValue({ actor: { userId: 'user-1' } });

    await resolveServerContext();

    expect(mocks.resolveContext).toHaveBeenCalledWith('browser-fingerprint');
  });

  it('uses the authenticated session path when auth is enabled', async () => {
    mocks.config.auth.enabled = true;
    mocks.resolveContext.mockResolvedValue({ actor: { userId: 'user-1' } });

    await resolveServerContext();

    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.resolveContext).toHaveBeenCalledWith();
  });
});
