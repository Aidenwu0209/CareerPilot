import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-083 tests: production readiness & configuration checklist.
 *
 * Verifies:
 * - readiness returns 200 when DB is ready and migrations are current
 * - readiness returns 503 when DB initialization fails
 * - readiness returns 503 when migrations are behind the code's set
 * - readiness returns 503 when production configuration is invalid
 * - response never leaks connection strings, secrets, or internal errors
 * - production checklist includes auth mode, db type, migration status,
 *   secret presence, public routes, and backup status
 * - a failed instance (503) prevents traffic — deployment-layer assertion
 */

beforeEach(() => {
  vi.resetModules();
});

/**
 * Helper: mock @/lib/db, @/lib/config, @/lib/env, and the migration-status
 * module so the route can be tested in isolation.
 */
async function loadRoute(overrides: {
  dbReady?: Promise<unknown>;
  dbExecute?: ReturnType<typeof vi.fn>;
  dbType?: 'postgresql' | 'sqlite';
  envValidation?: { ok: boolean; issues: Array<{ field: string; message: string }> };
}) {
  const dbReady =
    overrides.dbReady !== undefined
      ? overrides.dbReady
      : Promise.resolve();

  // Prevent unhandled-rejection warnings: rejected promises are caught by
  // checkReadiness via await, but Node may fire the warning before that.
  // Attaching a noop .catch() registers a rejection handler without resolving.
  dbReady.catch(() => {});
  const dbExecute = (
    overrides.dbExecute ??
    vi.fn().mockResolvedValue([{ count: 999 }])
  ) as (...args: unknown[]) => Promise<Array<{ count: number }>>;

  vi.doMock('@/lib/db', () => ({ dbReady, db: { execute: dbExecute }, adapter: {} }));
  vi.doMock('@/lib/config', () => ({
    config: {
      runtime: { demoMode: false, productMode: true, mode: 'product' },
      auth: { enabled: true, providers: ['google'] },
      db: { type: overrides.dbType ?? 'postgresql' },
      i18n: { defaultLocale: 'zh', locales: ['zh', 'en'] },
    },
  }));
  vi.doMock('@/lib/env', () => ({
    validateEnv: () => overrides.envValidation ?? { ok: true, issues: [] },
  }));
  vi.doMock('@/lib/db/migration-status', () => ({
    getExpectedPGMigrationCount: () => 12,
    getAppliedPGMigrationCount: async () => {
      const result = await dbExecute();
      return Number(result[0]?.count ?? 0);
    },
  }));

  return import('./route').then((m) => m.GET);
}

// ---------------------------------------------------------------------------
// US-083 AC: readiness checks process, PostgreSQL connection, migration version
// ---------------------------------------------------------------------------

describe('Health endpoint — healthy instance', () => {
  it('returns 200 with all checks true when DB is ready and migrations current', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 12 }]),
      dbType: 'postgresql',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.status).toBe('ok');
    expect(body.checks.process).toBe(true);
    expect(body.checks.database).toBe(true);
    expect(body.checks.migrations).toBe(true);
    expect(body.checks.configuration).toBe(true);
    expect(body.migration).toEqual({ expected: 12, applied: 12 });
  });
});

// ---------------------------------------------------------------------------
// Production configuration invalid → fail
// ---------------------------------------------------------------------------

describe('Health endpoint — invalid production configuration', () => {
  it('returns 503 when security-critical environment validation fails', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 12 }]),
      dbType: 'postgresql',
      envValidation: {
        ok: false,
        issues: [{ field: 'AUTH_SECRET', message: 'unsafe secret value' }],
      },
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();

    expect(body.status).toBe('unavailable');
    expect(body.checks.configuration).toBe(false);
    expect(body.checklist.env.configIssues).toBe(1);
    expect(JSON.stringify(body)).not.toContain('AUTH_SECRET');
    expect(JSON.stringify(body)).not.toContain('unsafe secret value');
  });
});

// ---------------------------------------------------------------------------
// US-083 AC: DB unreachable → fail
// ---------------------------------------------------------------------------

describe('Health endpoint — DB not ready', () => {
  it('returns 503 when database initialization failed', async () => {
    const GET = await loadRoute({
      dbReady: Promise.reject(new Error('connection refused')),
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();

    expect(body.status).toBe('unavailable');
    expect(body.checks.database).toBe(false);
    expect(body.checks.process).toBe(true);
  });

  it('does not leak the original error message or connection string', async () => {
    const GET = await loadRoute({
      dbReady: Promise.reject(
        new Error('postgres://user:s3cr3tP@ssW0rd@10.0.0.1:5432/prod — password auth failed'),
      ),
    });

    const response = await GET();
    const bodyStr = JSON.stringify(await response.json());

    // Must NOT leak the connection string, credentials, or internal error
    expect(bodyStr).not.toContain('postgres://user');
    expect(bodyStr).not.toContain('10.0.0.1');
    expect(bodyStr).not.toContain('s3cr3tP@ssW0rd');
    expect(bodyStr).not.toContain('password auth failed');
    expect(bodyStr).not.toContain('connection refused');
  });
});

// ---------------------------------------------------------------------------
// US-083 AC: migration behind → fail
// ---------------------------------------------------------------------------

describe('Health endpoint — migration stale', () => {
  it('returns 503 when applied migrations < expected migrations', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 8 }]), // 8 applied, 12 expected
      dbType: 'postgresql',
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();

    expect(body.status).toBe('unavailable');
    expect(body.checks.database).toBe(true);
    expect(body.checks.migrations).toBe(false);
    expect(body.migration).toEqual({ expected: 12, applied: 8 });
  });

  it('returns 200 when applied migrations exceed expected (forward-compatible)', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 15 }]), // 15 applied, 12 expected
      dbType: 'postgresql',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.checks.migrations).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// US-083 AC: production checklist
// ---------------------------------------------------------------------------

describe('Health endpoint — production checklist', () => {
  it('checklist includes auth mode, db type, migration, secrets, routes, backup', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 12 }]),
      dbType: 'postgresql',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    const checklist = body.checklist;

    expect(checklist).toBeDefined();
    expect(checklist.authMode).toBeDefined();
    expect(checklist.dbType).toBe('postgresql');
    expect(checklist.migration).toBeDefined();
    expect(checklist.migration.upToDate).toBe(true);
    expect(checklist.secrets).toBeDefined();
    expect(checklist.publicRoutes).toBeDefined();
    expect(checklist.backup).toBeDefined();
    expect(checklist.env).toBeDefined();
  });

  it('checklist reports secret presence/absence without leaking values', async () => {
    // Set some env vars for this test
    process.env.AUTH_SECRET = 'a-test-secret-that-is-long-enough-1234567890';
    process.env.AI_CREDENTIAL_MASTER_KEY = 'a-different-master-key-long-enough';

    try {
      const GET = await loadRoute({
        dbReady: Promise.resolve(),
        dbType: 'postgresql',
      });

      const response = await GET();
      const bodyStr = JSON.stringify(await response.json());

      // Secrets are reported as set/missing, never the actual value
      expect(bodyStr).not.toContain('a-test-secret-that-is-long-enough');
      expect(bodyStr).not.toContain('a-different-master-key');
      expect(bodyStr).toContain('"set"');
    } finally {
      delete process.env.AUTH_SECRET;
      delete process.env.AI_CREDENTIAL_MASTER_KEY;
    }
  });

  it('checklist lists public page and API routes', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbType: 'postgresql',
    });

    const response = await GET();
    const body = await response.json();

    expect(body.checklist.publicRoutes.pages).toContain('/login');
    expect(body.checklist.publicRoutes.pages).toContain('/privacy');
    expect(body.checklist.publicRoutes.api).toContain('/api/health');
    expect(body.checklist.publicRoutes.api).toContain('/api/auth');
  });
});

// ---------------------------------------------------------------------------
// US-083 AC: failed instance must not receive new traffic
// (deployment-layer assertion: 503 means the load balancer should drain)
// ---------------------------------------------------------------------------

describe('Health endpoint — deployment traffic gating', () => {
  it('a 503 response signals the instance must not receive business traffic', async () => {
    const GET = await loadRoute({
      dbReady: Promise.reject(new Error('db down')),
    });

    const response = await GET();

    // The load balancer / deployment layer checks status code:
    // 503 → stop routing new requests to this instance.
    expect(response.status).toBe(503);

    // Even in failure, the response must be valid JSON with safe content.
    const body = await response.json();
    expect(body.status).toBe('unavailable');
    expect(body.checks.process).toBe(true);
    expect(body.checks.database).toBe(false);
  });

  it('migration-stale instance returns 503 (no traffic until caught up)', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbExecute: vi.fn().mockResolvedValue([{ count: 5 }]),
      dbType: 'postgresql',
    });

    const response = await GET();
    expect(response.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// US-083 AC: no secret/connection-string/user-data/stacktrace leak (comprehensive)
// ---------------------------------------------------------------------------

describe('Health endpoint — no sensitive data leakage', () => {
  it('response body never contains DATABASE_URL or connection string', async () => {
    process.env.DATABASE_URL = 'postgresql://admin:s3cr3t@db.internal:5432/prod';
    process.env.AUTH_SECRET = 'super-long-production-secret-value-1234567890';

    try {
      const GET = await loadRoute({
        dbReady: Promise.reject(new Error('ECONNREFUSED db.internal:5432')),
        dbType: 'postgresql',
      });

      const response = await GET();
      const bodyStr = JSON.stringify(await response.json());

      expect(bodyStr).not.toContain('admin:s3cr3t');
      expect(bodyStr).not.toContain('db.internal');
      expect(bodyStr).not.toContain('ECONNREFUSED');
      expect(bodyStr).not.toContain('super-long-production-secret-value');
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.AUTH_SECRET;
    }
  });
});

// ---------------------------------------------------------------------------
// SQLite (dev) — migration check is skipped
// ---------------------------------------------------------------------------

describe('Health endpoint — SQLite dev mode', () => {
  it('returns 200 without PG migration check when dbType is sqlite', async () => {
    const GET = await loadRoute({
      dbReady: Promise.resolve(),
      dbType: 'sqlite',
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.checks.database).toBe(true);
    expect(body.checks.migrations).toBe(true);
    expect(body.migration).toBeUndefined();
  });
});
