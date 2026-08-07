import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-008 tests: AI operations, provider attempts, and credit holds schema integrity.
 *
 * Verifies:
 * - ai_operations: actor, billing account, capability, status, idempotency, settlement link
 * - ai_provider_attempts: operation FK, model FK, attempt_number unique per operation, usage, provider request ID
 * - credit_holds: account FK, operation FK, hold/settled amounts, status, expiry
 * - CHECK constraints: hold_amount >= 0, settled_amount >= 0, attempt_number >= 1
 * - FK constraints: valid references enforced, cascade and restrict rules
 * - Unique constraints: idempotency_key unique, (operation_id, attempt_number) compound unique
 */

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
});

afterAll(() => {
  sqlite.close();
});

// ── Helper: insert prerequisite entities ──

function setupUser(id: string, email?: string) {
  sqlite
    .prepare(
      `INSERT INTO users (id, email, auth_type) VALUES (?, ?, 'oauth')`,
    )
    .run(id, email ?? `${id}@test.com`);
}

function setupCreditAccount(id: string, ownerId: string, balance = 1000) {
  sqlite
    .prepare(
      `INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('${id}', 'user', '${ownerId}', ${balance})`,
    )
    .run();
}

function setupProviderAndModel(providerId: string, modelId: string) {
  sqlite
    .prepare(
      `INSERT INTO ai_providers (id, type, name) VALUES (?, 'google', 'Test Provider')`,
    )
    .run(providerId);
  sqlite
    .prepare(
      `INSERT INTO ai_models (id, provider_id, model_identifier, display_name) VALUES (?, ?, ?, 'Test Model')`,
    )
    .run(modelId, providerId, `model-${modelId}`);
}

// ── ai_operations ──

describe('US-008: ai_operations table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(ai_operations)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('actor_id');
    expect(columnNames).toContain('billing_account_id');
    expect(columnNames).toContain('capability');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('idempotency_key');
    expect(columnNames).toContain('final_settlement_id');
    expect(columnNames).toContain('metadata');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults status to pending and metadata to {}', () => {
    setupUser('user-op-defaults');
    setupCreditAccount('acct-op-defaults', 'user-op-defaults');

    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-defaults', 'user-op-defaults', 'acct-op-defaults', 'resume_optimize', 'idem-defaults')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT status, metadata FROM ai_operations WHERE id = ?')
      .get('op-defaults') as { status: string; metadata: string };
    expect(row.status).toBe('pending');
    expect(row.metadata).toBe('{}');
  });

  it('supports all status values', () => {
    setupUser('user-op-status');
    setupCreditAccount('acct-op-status', 'user-op-status');

    const statuses = ['pending', 'in_progress', 'succeeded', 'failed', 'cancelled'];
    for (const status of statuses) {
      sqlite
        .prepare(
          `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key, status)
           VALUES (?, 'user-op-status', 'acct-op-status', 'chat', ?, ?)`,
        )
        .run(`op-${status}`, `idem-${status}`, status);
    }

    for (const status of statuses) {
      const row = sqlite
        .prepare('SELECT status FROM ai_operations WHERE id = ?')
        .get(`op-${status}`) as { status: string };
      expect(row.status).toBe(status);
    }
  });

  it('stores capability field for business context', () => {
    setupUser('user-op-cap');
    setupCreditAccount('acct-op-cap', 'user-op-cap');

    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-cap', 'user-op-cap', 'acct-op-cap', 'cover_letter', 'idem-cap')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT capability FROM ai_operations WHERE id = ?')
      .get('op-cap') as { capability: string };
    expect(row.capability).toBe('cover_letter');
  });

  it('stores metadata as JSON', () => {
    setupUser('user-op-meta');
    setupCreditAccount('acct-op-meta', 'user-op-meta');

    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key, metadata)
         VALUES ('op-meta', 'user-op-meta', 'acct-op-meta', 'chat', 'idem-meta', '{"resumeId":"res-123","sessionId":"ses-456"}')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT metadata FROM ai_operations WHERE id = ?')
      .get('op-meta') as { metadata: string };
    const meta = JSON.parse(row.metadata);
    expect(meta.resumeId).toBe('res-123');
    expect(meta.sessionId).toBe('ses-456');
  });
});

describe('US-008: ai_operations idempotency_key unique', () => {
  it('rejects duplicate idempotency_key', () => {
    setupUser('user-op-idem');
    setupCreditAccount('acct-op-idem', 'user-op-idem');

    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-idem-1', 'user-op-idem', 'acct-op-idem', 'chat', 'unique-idem-key')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
           VALUES ('op-idem-2', 'user-op-idem', 'acct-op-idem', 'chat', 'unique-idem-key')`,
        )
        .run();
    }).toThrow();
  });
});

describe('US-008: ai_operations FK constraints', () => {
  it('rejects operation with non-existent actor_id', () => {
    setupCreditAccount('acct-fk-actor', 'user-fk-actor');
    setupUser('user-fk-actor');

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
           VALUES ('op-fk-actor', 'nonexistent-user', 'acct-fk-actor', 'chat', 'idem-fk-actor')`,
        )
        .run();
    }).toThrow();
  });

  it('rejects operation with non-existent billing_account_id', () => {
    setupUser('user-fk-acct');

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
           VALUES ('op-fk-acct', 'user-fk-acct', 'nonexistent-acct', 'chat', 'idem-fk-acct')`,
        )
        .run();
    }).toThrow();
  });

  it('final_settlement_id is nullable', () => {
    setupUser('user-op-settle');
    setupCreditAccount('acct-op-settle', 'user-op-settle');

    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-settle', 'user-op-settle', 'acct-op-settle', 'chat', 'idem-settle')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT final_settlement_id FROM ai_operations WHERE id = ?')
      .get('op-settle') as { final_settlement_id: string | null };
    expect(row.final_settlement_id).toBeNull();
  });
});

// ── ai_provider_attempts ──

describe('US-008: ai_provider_attempts table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(ai_provider_attempts)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('operation_id');
    expect(columnNames).toContain('model_id');
    expect(columnNames).toContain('attempt_number');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('usage');
    expect(columnNames).toContain('provider_request_id');
    expect(columnNames).toContain('error_message');
    expect(columnNames).toContain('duration_ms');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('completed_at');
  });

  it('defaults status to pending and usage to {}', () => {
    setupUser('user-attempt-defaults');
    setupCreditAccount('acct-attempt-defaults', 'user-attempt-defaults');
    setupProviderAndModel('prov-attempt-defaults', 'model-attempt-defaults');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-defaults', 'user-attempt-defaults', 'acct-attempt-defaults', 'chat', 'idem-attempt-defaults')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
         VALUES ('attempt-defaults', 'op-attempt-defaults', 'model-attempt-defaults', 1)`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT status, usage FROM ai_provider_attempts WHERE id = ?')
      .get('attempt-defaults') as { status: string; usage: string };
    expect(row.status).toBe('pending');
    expect(row.usage).toBe('{}');
  });

  it('stores usage with token counts (non-sensitive data)', () => {
    setupUser('user-attempt-usage');
    setupCreditAccount('acct-attempt-usage', 'user-attempt-usage');
    setupProviderAndModel('prov-attempt-usage', 'model-attempt-usage');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-usage', 'user-attempt-usage', 'acct-attempt-usage', 'chat', 'idem-attempt-usage')`,
      )
      .run();

    const usage = JSON.stringify({ inputTokens: 500, outputTokens: 200, totalTokens: 700 });
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, usage)
         VALUES ('attempt-usage', 'op-attempt-usage', 'model-attempt-usage', 1, 'succeeded', ?)`,
      )
      .run(usage);

    const row = sqlite
      .prepare('SELECT usage FROM ai_provider_attempts WHERE id = ?')
      .get('attempt-usage') as { usage: string };
    const parsed = JSON.parse(row.usage);
    expect(parsed.inputTokens).toBe(500);
    expect(parsed.outputTokens).toBe(200);
    expect(parsed.totalTokens).toBe(700);
  });

  it('stores provider_request_id for traceability', () => {
    setupUser('user-attempt-req');
    setupCreditAccount('acct-attempt-req', 'user-attempt-req');
    setupProviderAndModel('prov-attempt-req', 'model-attempt-req');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-req', 'user-attempt-req', 'acct-attempt-req', 'chat', 'idem-attempt-req')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, provider_request_id)
         VALUES ('attempt-req', 'op-attempt-req', 'model-attempt-req', 1, 'req-abc-123')`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT provider_request_id FROM ai_provider_attempts WHERE id = ?')
      .get('attempt-req') as { provider_request_id: string };
    expect(row.provider_request_id).toBe('req-abc-123');
  });

  it('stores error_message and duration_ms', () => {
    setupUser('user-attempt-err');
    setupCreditAccount('acct-attempt-err', 'user-attempt-err');
    setupProviderAndModel('prov-attempt-err', 'model-attempt-err');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-err', 'user-attempt-err', 'acct-attempt-err', 'chat', 'idem-attempt-err')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, error_message, duration_ms)
         VALUES ('attempt-err', 'op-attempt-err', 'model-attempt-err', 1, 'failed', 'Rate limit exceeded', 1500)`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT error_message, duration_ms FROM ai_provider_attempts WHERE id = ?')
      .get('attempt-err') as { error_message: string; duration_ms: number };
    expect(row.error_message).toBe('Rate limit exceeded');
    expect(row.duration_ms).toBe(1500);
  });
});

describe('US-008: ai_provider_attempts attempt_number unique per operation', () => {
  it('compound unique on (operation_id, attempt_number) prevents duplicates', () => {
    setupUser('user-attempt-unique');
    setupCreditAccount('acct-attempt-unique', 'user-attempt-unique');
    setupProviderAndModel('prov-attempt-unique', 'model-attempt-unique');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-unique', 'user-attempt-unique', 'acct-attempt-unique', 'chat', 'idem-attempt-unique')`,
      )
      .run();

    // First attempt with number 1
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
         VALUES ('attempt-1', 'op-attempt-unique', 'model-attempt-unique', 1)`,
      )
      .run();

    // Second attempt with number 2 — allowed
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
         VALUES ('attempt-2', 'op-attempt-unique', 'model-attempt-unique', 2)`,
      )
      .run();

    // Duplicate attempt number 1 — must fail
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-3', 'op-attempt-unique', 'model-attempt-unique', 1)`,
        )
        .run();
    }).toThrow();

    // Same attempt number on a DIFFERENT operation is allowed
    setupUser('user-attempt-other');
    setupCreditAccount('acct-attempt-other', 'user-attempt-other');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-other', 'user-attempt-other', 'acct-attempt-other', 'chat', 'idem-attempt-other')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-other-1', 'op-attempt-other', 'model-attempt-unique', 1)`,
        )
        .run();
    }).not.toThrow();
  });
});

describe('US-008: ai_provider_attempts CHECK attempt_number >= 1', () => {
  it('rejects attempt_number of 0', () => {
    setupUser('user-attempt-zero');
    setupCreditAccount('acct-attempt-zero', 'user-attempt-zero');
    setupProviderAndModel('prov-attempt-zero', 'model-attempt-zero');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-zero', 'user-attempt-zero', 'acct-attempt-zero', 'chat', 'idem-attempt-zero')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-zero', 'op-attempt-zero', 'model-attempt-zero', 0)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects negative attempt_number', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-neg', 'op-attempt-zero', 'model-attempt-zero', -1)`,
        )
        .run();
    }).toThrow();
  });
});

describe('US-008: ai_provider_attempts FK constraints', () => {
  it('rejects attempt with non-existent operation_id', () => {
    setupProviderAndModel('prov-attempt-fk-op', 'model-attempt-fk-op');

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-fk-op', 'nonexistent-op', 'model-attempt-fk-op', 1)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects attempt with non-existent model_id', () => {
    setupUser('user-attempt-fk-model');
    setupCreditAccount('acct-attempt-fk-model', 'user-attempt-fk-model');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-fk-model', 'user-attempt-fk-model', 'acct-attempt-fk-model', 'chat', 'idem-attempt-fk-model')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
           VALUES ('attempt-fk-model', 'op-attempt-fk-model', 'nonexistent-model', 1)`,
        )
        .run();
    }).toThrow();
  });

  it('cascade deletes attempts when operation is deleted', () => {
    setupUser('user-attempt-cascade');
    setupCreditAccount('acct-attempt-cascade', 'user-attempt-cascade');
    setupProviderAndModel('prov-attempt-cascade', 'model-attempt-cascade');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-attempt-cascade', 'user-attempt-cascade', 'acct-attempt-cascade', 'chat', 'idem-attempt-cascade')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
         VALUES ('attempt-cascade-1', 'op-attempt-cascade', 'model-attempt-cascade', 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number)
         VALUES ('attempt-cascade-2', 'op-attempt-cascade', 'model-attempt-cascade', 2)`,
      )
      .run();

    // Verify attempts exist
    const before = sqlite
      .prepare('SELECT COUNT(*) as count FROM ai_provider_attempts WHERE operation_id = ?')
      .get('op-attempt-cascade') as { count: number };
    expect(before.count).toBe(2);

    // Delete the operation
    sqlite.prepare('DELETE FROM ai_operations WHERE id = ?').run('op-attempt-cascade');

    // Attempts should be cascade deleted
    const after = sqlite
      .prepare('SELECT COUNT(*) as count FROM ai_provider_attempts WHERE operation_id = ?')
      .get('op-attempt-cascade') as { count: number };
    expect(after.count).toBe(0);
  });
});

// ── credit_holds ──

describe('US-008: credit_holds table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(credit_holds)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('account_id');
    expect(columnNames).toContain('operation_id');
    expect(columnNames).toContain('hold_amount');
    expect(columnNames).toContain('settled_amount');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('expires_at');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('settled_at');
  });

  it('defaults settled_amount to 0 and status to active', () => {
    setupUser('user-hold-defaults');
    setupCreditAccount('acct-hold-defaults', 'user-hold-defaults');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-defaults', 'user-hold-defaults', 'acct-hold-defaults', 'chat', 'idem-hold-defaults')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
         VALUES ('hold-defaults', 'acct-hold-defaults', 'op-hold-defaults', 50)`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT settled_amount, status FROM credit_holds WHERE id = ?')
      .get('hold-defaults') as { settled_amount: number; status: string };
    expect(row.settled_amount).toBe(0);
    expect(row.status).toBe('active');
  });

  it('stores expiry time for holds', () => {
    setupUser('user-hold-expiry');
    setupCreditAccount('acct-hold-expiry', 'user-hold-expiry');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-expiry', 'user-hold-expiry', 'acct-hold-expiry', 'chat', 'idem-hold-expiry')`,
      )
      .run();

    const futureTime = Math.floor(Date.now() / 1000) + 300; // 5 min from now
    sqlite
      .prepare(
        `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount, expires_at)
         VALUES ('hold-expiry', 'acct-hold-expiry', 'op-hold-expiry', 100, ?)`,
      )
      .run(futureTime);

    const row = sqlite
      .prepare('SELECT expires_at FROM credit_holds WHERE id = ?')
      .get('hold-expiry') as { expires_at: number };
    expect(row.expires_at).toBe(futureTime);
  });

  it('supports all status values', () => {
    setupUser('user-hold-status');
    setupCreditAccount('acct-hold-status', 'user-hold-status');

    const statuses = ['active', 'settled', 'released', 'expired'];
    for (const status of statuses) {
      sqlite
        .prepare(
          `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
           VALUES (?, 'user-hold-status', 'acct-hold-status', 'chat', ?)`,
        )
        .run(`op-hold-${status}`, `idem-hold-${status}`);

      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount, status)
           VALUES (?, 'acct-hold-status', ?, 10, ?)`,
        )
        .run(`hold-${status}`, `op-hold-${status}`, status);
    }

    for (const status of statuses) {
      const row = sqlite
        .prepare('SELECT status FROM credit_holds WHERE id = ?')
        .get(`hold-${status}`) as { status: string };
      expect(row.status).toBe(status);
    }
  });
});

describe('US-008: credit_holds CHECK constraints', () => {
  it('rejects negative hold_amount', () => {
    setupUser('user-hold-neg');
    setupCreditAccount('acct-hold-neg', 'user-hold-neg');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-neg', 'user-hold-neg', 'acct-hold-neg', 'chat', 'idem-hold-neg')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
           VALUES ('hold-neg', 'acct-hold-neg', 'op-hold-neg', -1)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects negative settled_amount', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount, settled_amount)
           VALUES ('hold-neg-settled', 'acct-hold-neg', 'op-hold-neg', 10, -5)`,
        )
        .run();
    }).toThrow();
  });

  it('accepts zero hold_amount and settled_amount', () => {
    setupUser('user-hold-zero');
    setupCreditAccount('acct-hold-zero', 'user-hold-zero');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-zero', 'user-hold-zero', 'acct-hold-zero', 'chat', 'idem-hold-zero')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount, settled_amount)
           VALUES ('hold-zero', 'acct-hold-zero', 'op-hold-zero', 0, 0)`,
        )
        .run();
    }).not.toThrow();
  });
});

describe('US-008: credit_holds FK constraints', () => {
  it('rejects hold with non-existent account_id', () => {
    setupUser('user-hold-fk-acct');
    setupCreditAccount('acct-hold-fk-acct', 'user-hold-fk-acct');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-fk-acct', 'user-hold-fk-acct', 'acct-hold-fk-acct', 'chat', 'idem-hold-fk-acct')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
           VALUES ('hold-fk-acct', 'nonexistent-acct', 'op-hold-fk-acct', 10)`,
        )
        .run();
    }).toThrow();
  });

  it('rejects hold with non-existent operation_id', () => {
    setupUser('user-hold-fk-op');
    setupCreditAccount('acct-hold-fk-op', 'user-hold-fk-op');

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
           VALUES ('hold-fk-op', 'acct-hold-fk-op', 'nonexistent-op', 10)`,
        )
        .run();
    }).toThrow();
  });

  it('restricts deletion of credit account with holds', () => {
    setupUser('user-hold-restrict');
    setupCreditAccount('acct-hold-restrict', 'user-hold-restrict');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-restrict', 'user-hold-restrict', 'acct-hold-restrict', 'chat', 'idem-hold-restrict')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
         VALUES ('hold-restrict', 'acct-hold-restrict', 'op-hold-restrict', 10)`,
      )
      .run();

    // Deleting the account should fail because of ON DELETE restrict
    expect(() => {
      sqlite.prepare('DELETE FROM credit_accounts WHERE id = ?').run('acct-hold-restrict');
    }).toThrow();
  });

  it('cascade deletes holds when operation is deleted', () => {
    setupUser('user-hold-cascade');
    setupCreditAccount('acct-hold-cascade', 'user-hold-cascade');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-hold-cascade', 'user-hold-cascade', 'acct-hold-cascade', 'chat', 'idem-hold-cascade')`,
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
         VALUES ('hold-cascade', 'acct-hold-cascade', 'op-hold-cascade', 10)`,
      )
      .run();

    // Verify hold exists
    const before = sqlite
      .prepare('SELECT COUNT(*) as count FROM credit_holds WHERE operation_id = ?')
      .get('op-hold-cascade') as { count: number };
    expect(before.count).toBe(1);

    // Delete the operation — hold should cascade
    sqlite.prepare('DELETE FROM ai_operations WHERE id = ?').run('op-hold-cascade');

    const after = sqlite
      .prepare('SELECT COUNT(*) as count FROM credit_holds WHERE operation_id = ?')
      .get('op-hold-cascade') as { count: number };
    expect(after.count).toBe(0);
  });
});

// ── Integration: operation → attempts → holds relationship ──

describe('US-008: full operation lifecycle relationship', () => {
  it('supports operation with multiple attempts and a single active hold', () => {
    setupUser('user-lifecycle');
    setupCreditAccount('acct-lifecycle', 'user-lifecycle', 500);
    setupProviderAndModel('prov-lifecycle', 'model-lifecycle');

    // Create operation
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key, status)
         VALUES ('op-lifecycle', 'user-lifecycle', 'acct-lifecycle', 'resume_optimize', 'idem-lifecycle', 'in_progress')`,
      )
      .run();

    // Create credit hold
    sqlite
      .prepare(
        `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount)
         VALUES ('hold-lifecycle', 'acct-lifecycle', 'op-lifecycle', 30)`,
      )
      .run();

    // First attempt (succeeded but result was bad, needs retry)
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, usage)
         VALUES ('attempt-lifecycle-1', 'op-lifecycle', 'model-lifecycle', 1, 'succeeded', '{"inputTokens":100,"outputTokens":50}')`,
      )
      .run();

    // Second attempt (retry)
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, usage)
         VALUES ('attempt-lifecycle-2', 'op-lifecycle', 'model-lifecycle', 2, 'succeeded', '{"inputTokens":100,"outputTokens":80}')`,
      )
      .run();

    // Verify relationships
    const op = sqlite
      .prepare('SELECT status FROM ai_operations WHERE id = ?')
      .get('op-lifecycle') as { status: string };
    expect(op.status).toBe('in_progress');

    const attempts = sqlite
      .prepare('SELECT COUNT(*) as count, SUM(attempt_number) as sum_attempts FROM ai_provider_attempts WHERE operation_id = ?')
      .get('op-lifecycle') as { count: number; sum_attempts: number };
    expect(attempts.count).toBe(2);
    expect(attempts.sum_attempts).toBe(3); // 1 + 2

    const holds = sqlite
      .prepare('SELECT hold_amount, status FROM credit_holds WHERE operation_id = ?')
      .get('op-lifecycle') as { hold_amount: number; status: string };
    expect(holds.hold_amount).toBe(30);
    expect(holds.status).toBe('active');
  });

  it('sensitive data (prompt/resume/credentials) is NOT in default usage fields', () => {
    setupUser('user-no-sensitive');
    setupCreditAccount('acct-no-sensitive', 'user-no-sensitive');
    setupProviderAndModel('prov-no-sensitive', 'model-no-sensitive');
    sqlite
      .prepare(
        `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, idempotency_key)
         VALUES ('op-no-sensitive', 'user-no-sensitive', 'acct-no-sensitive', 'chat', 'idem-no-sensitive')`,
      )
      .run();

    // Usage should only contain non-sensitive metrics
    const safeUsage = JSON.stringify({
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      modelLatencyMs: 1200,
    });
    sqlite
      .prepare(
        `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, usage)
         VALUES ('attempt-no-sensitive', 'op-no-sensitive', 'model-no-sensitive', 1, 'succeeded', ?)`,
      )
      .run(safeUsage);

    const row = sqlite
      .prepare('SELECT usage FROM ai_provider_attempts WHERE id = ?')
      .get('attempt-no-sensitive') as { usage: string };
    const parsed = JSON.parse(row.usage);

    // Verify NO sensitive fields are present in the usage data
    expect(parsed).not.toHaveProperty('prompt');
    expect(parsed).not.toHaveProperty('resumeText');
    expect(parsed).not.toHaveProperty('apiKey');
    expect(parsed).not.toHaveProperty('credentials');
    expect(parsed).not.toHaveProperty('authorization');

    // Verify safe fields ARE present
    expect(parsed).toHaveProperty('inputTokens');
    expect(parsed).toHaveProperty('outputTokens');
  });
});

// ── PG schema verification ──

describe('US-008: PG schema defines AI operation tables', () => {
  it('pg-schema.ts exports aiOperations, aiProviderAttempts, and creditHolds', async () => {
    const pgSchema = await import('./pg-schema');
    expect(pgSchema.aiOperations).toBeDefined();
    expect(pgSchema.aiProviderAttempts).toBeDefined();
    expect(pgSchema.creditHolds).toBeDefined();
  });
});
