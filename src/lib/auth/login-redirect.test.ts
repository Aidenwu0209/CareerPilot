import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next-intl/server', () => ({ getLocale: mocks.getLocale }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { buildLoginRedirect, redirectToLogin } from './login-redirect';

describe('localized login redirect', () => {
  beforeEach(() => {
    mocks.getLocale.mockReset();
    mocks.redirect.mockReset();
  });

  it('localizes both the login route and callback route', () => {
    expect(buildLoginRedirect('zh', '/account')).toBe(
      '/zh/login?callbackUrl=%2Fzh%2Faccount',
    );
  });

  it('redirects with the active request locale', async () => {
    mocks.getLocale.mockResolvedValue('en');

    await redirectToLogin('/org-admin');

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/en/login?callbackUrl=%2Fen%2Forg-admin',
    );
  });
});
