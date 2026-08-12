import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { runtime: { demoMode: false } },
  cookies: vi.fn(),
  resolveContext: vi.fn(),
}));

vi.mock('@/lib/config', () => ({ config: mocks.config }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('./context', () => ({ resolveContext: mocks.resolveContext }));

import { resolveServerContext } from './server-context';

describe('resolveServerContext', () => {
  beforeEach(() => {
    mocks.config.runtime.demoMode = false;
    mocks.cookies.mockReset();
    mocks.resolveContext.mockReset();
  });

  it('uses only the authenticated session path in product mode', async () => {
    mocks.resolveContext.mockResolvedValue({ actor: { userId: 'user-1' } });
    await resolveServerContext();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.resolveContext).toHaveBeenCalledWith();
  });

  it('falls back to the explicit demo cookie only when no session exists', async () => {
    mocks.config.runtime.demoMode = true;
    mocks.resolveContext
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ actor: { userId: 'demo-user' } });
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'demo-fingerprint' }),
    });

    await resolveServerContext();

    expect(mocks.resolveContext).toHaveBeenNthCalledWith(1);
    expect(mocks.resolveContext).toHaveBeenNthCalledWith(2, 'demo-fingerprint');
  });
});
