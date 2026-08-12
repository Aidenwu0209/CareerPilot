import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * US-002 tests: SQLite adapter initialization behavior.
 *
 * Three required paths:
 * 1. Migration failure → constructor throws in production (fail-closed)
 * 2. Empty DB production startup → no demo/fingerprint seed
 * 3. Development seed → demo user created when DB is empty
 *
 * Note: Unlike PostgreSQLAdapter, SQLiteAdapter runs migrations in the
 * constructor (synchronous via better-sqlite3). Seeding happens in
 * initialize() but only in development.
 */

// --- Hoisted mock functions ---
const mocks = vi.hoisted(() => ({
  migrateFn: vi.fn(),
  prepareFn: vi.fn(),
  pragmaFn: vi.fn(),
  seedFn: vi.fn(),
  closeFn: vi.fn(),
  mkdirSyncFn: vi.fn(),
}));

// --- Module mocks ---
vi.mock('better-sqlite3', () => ({
  default: function MockDatabase() {
    return {
      pragma: mocks.pragmaFn,
      prepare: mocks.prepareFn,
      close: mocks.closeFn,
    };
  },
}));

vi.mock('drizzle-orm/better-sqlite3', () => ({
  drizzle: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({
  migrate: mocks.migrateFn,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, mkdirSync: mocks.mkdirSyncFn };
});

vi.mock('../schema', () => ({}));

vi.mock('../seed-demo', () => ({
  seedDemoUser: mocks.seedFn,
}));

// Import AFTER mocks are set up
import { SQLiteAdapter } from './sqlite';

const ORIGINAL_ENV = { ...process.env };

function setNodeEnv(env: string) {
  Object.assign(process.env, { NODE_ENV: env });
}

function enableDemoMode() {
  process.env.DEMO_MODE = 'true';
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: migrations succeed
  mocks.migrateFn.mockReturnValue(undefined);
  // Default: empty DB (count = 0)
  mocks.prepareFn.mockReturnValue({
    get: () => ({ count: 0 }),
  });
  mocks.seedFn.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('SQLiteAdapter — migration failure path', () => {
  it('throws in production when migration fails (fail-closed)', () => {
    setNodeEnv('production');
    mocks.migrateFn.mockImplementation(() => {
      throw new Error('migration checksum mismatch');
    });

    expect(
      () => new SQLiteAdapter('./data/test.db'),
    ).toThrow('migration checksum mismatch');
  });

  it('catches migration failure in development (does not throw)', () => {
    setNodeEnv('development');
    mocks.migrateFn.mockImplementation(() => {
      throw new Error('migration checksum mismatch');
    });

    expect(() => new SQLiteAdapter('./data/test.db')).not.toThrow();
  });
});

describe('SQLiteAdapter.initialize — empty production startup path', () => {
  it('does not seed in production even when DB is empty', async () => {
    setNodeEnv('production');

    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();

    expect(mocks.seedFn).not.toHaveBeenCalled();
  });
});

describe('SQLiteAdapter.initialize — development seed path', () => {
  it('seeds demo user when DB is empty in development', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.prepareFn.mockReturnValue({
      get: () => ({ count: 0 }),
    });

    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();

    expect(mocks.seedFn).toHaveBeenCalledTimes(1);
  });

  it('does not seed when DB already has users in development', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.prepareFn.mockReturnValue({
      get: () => ({ count: 3 }),
    });

    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();

    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('strictly skips demo seed when the catalog CLI guard is set to 1', async () => {
    setNodeEnv('development');
    enableDemoMode();
    process.env.CAREERPILOT_SKIP_DEMO_SEED = '1';
    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });
});

describe('SQLiteAdapter.initialize — repeated startup idempotency', () => {
  it('does not re-seed on second initialization when users exist', async () => {
    setNodeEnv('development');
    enableDemoMode();
    mocks.prepareFn.mockReturnValue({
      get: () => ({ count: 1 }),
    });

    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();
    await adapter.initialize();

    expect(mocks.seedFn).not.toHaveBeenCalled();
  });

  it('does not seed an empty development database in product mode', async () => {
    setNodeEnv('development');
    process.env.DEMO_MODE = 'false';
    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.initialize();
    expect(mocks.seedFn).not.toHaveBeenCalled();
  });
});

describe('SQLiteAdapter.close', () => {
  it('closes the sqlite database', async () => {
    const adapter = new SQLiteAdapter('./data/test.db');
    await adapter.close();
    expect(mocks.closeFn).toHaveBeenCalledOnce();
  });
});
