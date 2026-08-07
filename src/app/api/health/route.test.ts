import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-002 tests: health/readiness endpoint behavior.
 *
 * Verifies that when DB initialization fails:
 * - readiness returns 503 (business API unavailable)
 * - response does not leak secrets, connection strings, or internal errors
 *
 * And when DB initialization succeeds:
 * - readiness returns 200
 */

beforeEach(() => {
  vi.resetModules();
});

describe('Health endpoint — DB ready', () => {
  it('returns 200 when database initialization succeeded', async () => {
    vi.doMock('@/lib/db', () => ({
      dbReady: Promise.resolve(),
      db: {},
    }));

    const { GET } = await import('./route');
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});

describe('Health endpoint — DB not ready', () => {
  it('returns 503 when database initialization failed', async () => {
    vi.doMock('@/lib/db', () => ({
      dbReady: Promise.reject(new Error('connection refused')),
      db: {},
    }));

    const { GET } = await import('./route');
    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.status).toBe('unavailable');
    expect(body.db).toBeDefined();
    // Must NOT leak the actual error message
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });

  it('response body never contains sensitive internal details', async () => {
    vi.doMock('@/lib/db', () => ({
      dbReady: Promise.reject(
        new Error('postgres://user:secret@10.0.0.1:5432/prod — password authentication failed'),
      ),
      db: {},
    }));

    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.json();
    const bodyStr = JSON.stringify(body);

    // No connection strings
    expect(bodyStr).not.toContain('postgres://');
    expect(bodyStr).not.toContain('10.0.0.1');
    // No credentials
    expect(bodyStr).not.toContain('secret');
    expect(bodyStr).not.toContain('password');
  });
});
