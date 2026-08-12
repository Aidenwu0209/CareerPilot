import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * US-002 tests: PostgreSQL adapter initialization behavior.
 *
 * Three required paths:
 * 1. Migration failure → initialize() rejects in production
 * 2. Empty DB production startup → no demo/fingerprint seed
 * 3. Development seed → demo user created when DB is empty
 */

// --- Hoisted mock functions (available inside vi.mock factories) ---
const mocks = vi.hoisted(() => ({
  migrateFn: vi.fn(),
  executeFn: vi.fn(),
  seedFn: vi.fn(),
  clientEndFn: vi.fn(),
}));

// --- Module mocks ---
vi.mock('postgres', () => ({
  default: vi.fn(() => ({ end: mocks.clientEndFn })),
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray) => ({ __sqlText: strings.join('') }),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({ execute: mocks.executeFn })),
}));

vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: mocks.migrateFn,
}));

vi.mock('../seed-demo', () => ({
  seedDemoUser: mocks.seedFn,
}));

// Import AFTER mocks are set up
import { PostgreSQLAdapter } from './postgresql';

const ORIGINAL_ENV = { ...process.env };

type SqlMock = { __sqlText?: string };

function setNodeEnv(env: string) {
  Object.assign(process.env, { NODE_ENV: env });
}

function enableDemoMode() {
  process.env.DEMO_MODE = 'true';
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: migrations succeed, tables exist, DB is empty
  mocks.migrateFn.mockResolvedValue(undefined);
  mocks.executeFn.mockImplementation(async (arg: SqlMock) => {
    const q: string = arg?.__sqlText || '';
    if (q.includes('EXISTS')) return [{ ok: true }];
    if (q.includes('count(*)')) return [{ count: 0 }];
    return [];
  });
  mocks.seedFn.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('PostgreSQLAdapter.initialize — migration failure path', () => {
  it('rejects in production when migration fails', async () => {
    setNodeEnv('production');
    mocks.migrateFn.mockRejectedValue(new Error('syntax error in migration'));

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await expect(adapter.initialize()).rejects.toThrow('syntax error in migration');
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('catches migration failure in development (does not reject)', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.migrateFn.mockRejectedValue(new Error('connection refused'));

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    // Should not throw — dev catches and logs
    await expect(adapter.initialize()).resolves.toBeUndefined();
  });
});

describe('PostgreSQLAdapter.initialize — empty production startup path', () => {
  it('does not seed in production even when DB is empty', async () => {
    setNodeEnv('production');
    // execute returns empty DB (count = 0, but we won't even get there in prod)
    mocks.executeFn.mockImplementation(async (arg: SqlMock) => {
      const q: string = arg?.__sqlText || '';
      if (q.includes('EXISTS')) return [{ ok: true }];
      return [{ count: 0 }];
    });

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();

    // seedDemoUser must never be called in production
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('completes migrations successfully in production empty DB', async () => {
    setNodeEnv('production');

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();

    expect(mocks.migrateFn).toHaveBeenCalled();
  });
});

describe('PostgreSQLAdapter.initialize — development seed path', () => {
  it('seeds demo user when DB is empty in development', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.executeFn.mockImplementation(async (arg: SqlMock) => {
      const q: string = arg?.__sqlText || '';
      if (q.includes('EXISTS')) return [{ ok: true }];
      if (q.includes('count(*)')) return [{ count: 0 }]; // empty DB
      return [];
    });

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();

    expect(mocks.seedFn).toHaveBeenCalledTimes(1);
  });

  it('does not seed when DB already has users in development', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.executeFn.mockImplementation(async (arg: SqlMock) => {
      const q: string = arg?.__sqlText || '';
      if (q.includes('EXISTS')) return [{ ok: true }];
      if (q.includes('count(*)')) return [{ count: 5 }]; // non-empty
      return [];
    });

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();

    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('does not seed an empty development database in product mode', async () => {
    setNodeEnv('development');
    process.env.DEMO_MODE = 'false';
    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('strictly skips demo seed when the catalog CLI guard is set to 1', async () => {
    setNodeEnv('development');
    enableDemoMode();
    process.env.CAREERPILOT_SKIP_DEMO_SEED = '1';
    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });
});

describe('PostgreSQLAdapter.initialize — repeated startup idempotency', () => {
  it('does not re-seed on second initialization when users exist', async () => {
    setNodeEnv('development');
    mocks.executeFn.mockImplementation(async (arg: SqlMock) => {
      const q: string = arg?.__sqlText || '';
      if (q.includes('EXISTS')) return [{ ok: true }];
      if (q.includes('count(*)')) return [{ count: 1 }]; // already has users
      return [];
    });

    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.initialize();
    await adapter.initialize(); // second call

    expect(mocks.seedFn).not.toHaveBeenCalled();
  });
});

describe('PostgreSQLAdapter.close', () => {
  it('ends the postgres client connection', async () => {
    const adapter = new PostgreSQLAdapter('postgresql://user:pass@localhost:5432/db');
    await adapter.close();
    expect(mocks.clientEndFn).toHaveBeenCalledOnce();
  });
});
