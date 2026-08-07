import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-016 tests: Private API default authentication & public whitelist.
 *
 * Tests the middleware behavior for:
 * - Public API routes accessible without session (auth callbacks, health, share)
 * - Private API routes returning 401 AUTH_REQUIRED without session cookie
 * - Forged x-fingerprint header cannot bypass auth
 * - Public page paths (landing, login) accessible without session
 * - Private page paths redirect to login without session
 */

// We need to mock next-intl/middleware to avoid pulling i18n config
vi.mock('next-intl/middleware', () => ({
  default: () => () => {
    // Return a passthrough response
    return new Response(null, { status: 200 });
  },
}));

// We also need to mock the routing config import
vi.mock('@/i18n/routing', () => ({
  routing: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
  },
}));

function createRequest(
  pathname: string,
  options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): NextRequest {
  const url = `http://localhost${pathname}`;
  const headers = new Headers();
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  const req = new NextRequest(url, { method: 'GET', headers });

  // Set cookies
  if (options.cookies) {
    for (const [name, value] of Object.entries(options.cookies)) {
      req.cookies.set(name, value);
    }
  }

  return req;
}

beforeEach(() => {
  vi.resetModules();
});

describe('Middleware — API public whitelist', () => {
  it('allows /api/auth/* without session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/auth/[...nextauth]');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/auth/otp/request without session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/auth/otp/request');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/auth/otp/verify without session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/auth/otp/verify');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/health without session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/health');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/share/:token without session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/share/abc123token');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

describe('Middleware — private API requires session', () => {
  it('returns 401 AUTH_REQUIRED for /api/resume without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/resume');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 401 AUTH_REQUIRED for /api/ai/chat without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/ai/chat');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 401 AUTH_REQUIRED for /api/ai/models without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/ai/models');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 AUTH_REQUIRED for /api/linkedin-photo without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/linkedin-photo');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 AUTH_REQUIRED for /api/interview without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/interview');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 AUTH_REQUIRED for /api/user without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/user');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 AUTH_REQUIRED for /api/github/repo without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/github/repo');
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('allows private API with valid session cookie', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/resume', {
      cookies: { 'authjs.session-token': 'some-jwt-token' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows private API with production session cookie name', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/resume', {
      cookies: { '__Secure-authjs.session-token': 'some-jwt-token' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

describe('Middleware — forged x-fingerprint cannot bypass auth', () => {
  it('returns 401 for /api/resume with forged x-fingerprint but no session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/resume', {
      headers: { 'x-fingerprint': 'forged-fingerprint-123' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 401 for /api/ai/chat with forged x-fingerprint but no session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/ai/chat', {
      headers: { 'x-fingerprint': 'another-forged-fp' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 for /api/user with forged x-fingerprint but no session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/api/user', {
      headers: { 'x-fingerprint': 'evil-fp' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});

describe('Middleware — page routes (auth enabled)', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = 'true';
  });

  it('allows landing page without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/zh');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows login page without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/zh/login');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('redirects to login for /zh/dashboard without session', async () => {
    const { default: middleware } = await import('./middleware');
    const req = createRequest('/zh/dashboard');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('location') || '';
    expect(location).toContain('/zh/login');
    expect(location).toContain('callbackUrl=');
  });
});
