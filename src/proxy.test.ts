import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}));
vi.mock('./i18n/routing', () => ({
  routing: { locales: ['zh', 'en'], defaultLocale: 'zh' },
}));
vi.mock('next-auth/jwt', () => ({
  decode: vi.fn(async ({ token }: { token?: string }) => {
    if (token === 'session-token') return { userId: 'product-user' };
    if (token === 'onboarding-token') {
      return { userId: 'new-user', onboardingRequired: true };
    }
    return null;
  }),
}));

function createRequest(
  pathname: string,
  options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): NextRequest {
  const request = new NextRequest(`http://localhost${pathname}`, {
    headers: options.headers,
  });
  for (const [name, value] of Object.entries(options.cookies ?? {})) {
    request.cookies.set(name, value);
  }
  return request;
}

async function loadProxy(demoMode = false) {
  process.env.DEMO_MODE = demoMode ? 'true' : 'false';
  vi.resetModules();
  return import('./proxy');
}

beforeEach(() => {
  process.env.DEMO_MODE = 'false';
  process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters';
});

describe('product proxy', () => {
  it.each([
    '/api/auth/otp/request',
    '/api/branding',
    '/api/health',
    '/api/share/public-token',
    '/api/webhooks/stripe',
    '/api/internal/monitoring/check',
  ])('allows public API %s without a session', async (pathname) => {
    const { proxy } = await loadProxy();
    expect((await proxy(createRequest(pathname))).status).toBe(200);
  });

  it.each(['/api/resume', '/api/ai/chat', '/api/user']) (
    'rejects private API %s without a session',
    async (pathname) => {
      const { proxy } = await loadProxy();
      const response = await proxy(createRequest(pathname));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'AUTH_REQUIRED' });
    },
  );

  it('does not accept a fingerprint header in product mode', async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(createRequest('/api/resume', {
      headers: { 'x-fingerprint': 'demo-fingerprint' },
    }));
    expect(response.status).toBe(401);
  });

  it('preserves a valid request ID and generates one for unsafe input', async () => {
    const { proxy } = await loadProxy();
    const preserved = await proxy(createRequest('/api/health', {
      headers: { 'x-request-id': 'edge:req-42' },
    }));
    const generated = await proxy(createRequest('/api/health', {
      headers: { 'x-request-id': 'unsafe request id' },
    }));

    expect(preserved.headers.get('x-request-id')).toBe('edge:req-42');
    expect(generated.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('allows a private API with either Auth.js session cookie name', async () => {
    const { proxy } = await loadProxy();
    for (const name of ['authjs.session-token', '__Secure-authjs.session-token']) {
      const response = await proxy(createRequest('/api/resume', {
        cookies: { [name]: 'session-token' },
      }));
      expect(response.status).toBe(200);
    }
  });

  it.each(['/zh', '/zh/login', '/zh/forgot-password', '/en/help', '/en/privacy', '/zh/terms']) (
    'allows public page %s',
    async (pathname) => {
      const { proxy } = await loadProxy();
      expect((await proxy(createRequest(pathname))).status).toBe(200);
    },
  );

  it('serves the locale-neutral API docs page without auth or locale rewriting', async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(createRequest('/api-docs'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects /zh/dashboard to localized login with the full callback URL', async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(createRequest('/zh/dashboard?view=list'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/zh/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/zh/dashboard?view=list');
  });

  it('adds the default locale to an unprefixed private callback', async () => {
    const { proxy } = await loadProxy();
    const response = await proxy(createRequest('/dashboard'));
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/zh/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/zh/dashboard');
  });

  it('routes a new account to localized onboarding before private pages and APIs', async () => {
    const { proxy } = await loadProxy();
    const cookies = { 'authjs.session-token': 'onboarding-token' };
    const pageResponse = await proxy(createRequest('/en/career?tab=goals', { cookies }));
    const location = new URL(pageResponse.headers.get('location')!);
    expect(location.pathname).toBe('/en/onboarding');
    expect(location.searchParams.get('callbackUrl')).toBe('/en/career?tab=goals');

    const apiResponse = await proxy(createRequest('/api/resume', { cookies }));
    expect(apiResponse.status).toBe(403);
    await expect(apiResponse.json()).resolves.toEqual({ error: 'ONBOARDING_REQUIRED' });
  });

  it.each(['/zh/terms', '/en/privacy', '/zh/help', '/en/forgot-password'])(
    'allows onboarding users to access recovery and support page %s',
    async (pathname) => {
      const { proxy } = await loadProxy();
      const response = await proxy(createRequest(pathname, {
        cookies: { 'authjs.session-token': 'onboarding-token' },
      }));
      expect(response.status).toBe(200);
    },
  );

  it.each([
    ['/zh/account', '/zh/login', '/zh/account'],
    ['/en/career/jobs?level=entry', '/en/login', '/en/career/jobs?level=entry'],
    ['/zh/teacher/students', '/zh/login', '/zh/teacher/students'],
    ['/en/editor/resume-1', '/en/login', '/en/editor/resume-1'],
  ])(
    'protects %s and preserves locale in %s',
    async (pathname, expectedLogin, expectedCallback) => {
      const { proxy } = await loadProxy();
      const response = await proxy(createRequest(pathname));
      const location = new URL(response.headers.get('location')!);
      expect(response.status).toBe(307);
      expect(location.pathname).toBe(expectedLogin);
      expect(location.searchParams.get('callbackUrl')).toBe(expectedCallback);
    },
  );
});

describe('demo proxy', () => {
  it('accepts only a fixed demo identity cookie when demo mode is explicit', async () => {
    const { proxy } = await loadProxy(true);
    const accepted = await proxy(createRequest('/zh/dashboard', {
      cookies: { jade_fingerprint: 'demo-fingerprint' },
    }));
    const rejected = await proxy(createRequest('/zh/dashboard', {
      cookies: { jade_fingerprint: 'random-browser-id' },
    }));
    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(307);
  });

  it('keeps the independent demo entry public for page-level mode gating', async () => {
    const { proxy } = await loadProxy(true);
    expect((await proxy(createRequest('/zh/demo'))).status).toBe(200);
  });
});

describe('proxy matcher', () => {
  it('uses the Next.js 16 proxy file convention and excludes static assets', async () => {
    const { config } = await loadProxy();
    expect(config.matcher).toContain('/((?!_next|.*\\..*).*)');
  });
});
