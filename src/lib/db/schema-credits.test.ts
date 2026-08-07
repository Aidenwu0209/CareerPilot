import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-006 tests: Credits accounts, transactions (immutable ledger), and rules schema integrity.
 *
 * Verifies:
 * - credit_accounts: one account per owner (compound unique), non-negative balance CHECK
 * - credit_transactions: all required fields, non-negative before/after CHECK,
 *   idempotency key unique per account, immutability triggers block UPDATE and DELETE
 * - credit_rules: registration_grant and daily_limit rule types, versioning, non-negative value CHECK
 * - FK constraints: transactions reference accounts (restrict delete), rules.created_by references users
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

// ── credit_accounts ──

describe('US-006: credit_accounts table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(credit_accounts)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('owner_type');
    expect(columnNames).toContain('owner_id');
    expect(columnNames).toContain('balance');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults balance to 0 and status to active', () => {
    sqlite.prepare('DELETE FROM credit_accounts').run(); // clear any prior data
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id) VALUES ('test-acct-defaults', 'user', 'test-user-1')",
      )
      .run();
    const row = sqlite
      .prepare('SELECT balance, status FROM credit_accounts WHERE id = ?')
      .get('test-acct-defaults') as { balance: number; status: string };
    expect(row.balance).toBe(0);
    expect(row.status).toBe('active');
  });
});

describe('US-006: credit_accounts one account per owner', () => {
  it('compound unique on (owner_type, owner_id) prevents duplicate accounts', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id) VALUES ('acct-unique-1', 'user', 'unique-user-1')",
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO credit_accounts (id, owner_type, owner_id) VALUES ('acct-unique-2', 'user', 'unique-user-1')",
        )
        .run();
    }).toThrow();

    // Different owner_type with same owner_id is allowed (user vs org)
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO credit_accounts (id, owner_type, owner_id) VALUES ('acct-unique-3', 'organization', 'unique-user-1')",
        )
        .run();
    }).not.toThrow();
  });

  it('supports both user and organization owner types', () => {
    // Insert prerequisite organization
    sqlite
      .prepare(
        "INSERT INTO users (id, auth_type) VALUES ('org-owner-user', 'fingerprint')",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO organizations (id, slug, name, created_by) VALUES ('org-for-acct', 'org-for-acct', 'Test Org', 'org-owner-user')",
      )
      .run();

    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id) VALUES ('org-acct-1', 'organization', 'org-for-acct')",
      )
      .run();

    const row = sqlite
      .prepare('SELECT owner_type, owner_id FROM credit_accounts WHERE id = ?')
      .get('org-acct-1') as { owner_type: string; owner_id: string };
    expect(row.owner_type).toBe('organization');
    expect(row.owner_id).toBe('org-for-acct');
  });
});

describe('US-006: credit_accounts non-negative balance', () => {
  it('CHECK constraint rejects negative balance on insert', () => {
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('neg-balance-acct', 'user', 'neg-user', -100)",
        )
        .run();
    }).toThrow();
  });

  it('CHECK constraint rejects updating balance to negative', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('update-neg-acct', 'user', 'update-neg-user', 50)",
      )
      .run();

    expect(() => {
      sqlite
        .prepare('UPDATE credit_accounts SET balance = -10 WHERE id = ?')
        .get('update-neg-acct');
    }).toThrow();
  });
});

// ── credit_transactions ──

describe('US-006: credit_transactions table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(credit_transactions)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('account_id');
    expect(columnNames).toContain('balance_before');
    expect(columnNames).toContain('delta');
    expect(columnNames).toContain('balance_after');
    expect(columnNames).toContain('reason');
    expect(columnNames).toContain('operator_id');
    expect(columnNames).toContain('business_ref_id');
    expect(columnNames).toContain('idempotency_key');
    expect(columnNames).toContain('rule_snapshot');
    expect(columnNames).toContain('note');
    expect(columnNames).toContain('created_at');
  });
});

describe('US-006: credit_transactions idempotency and FK', () => {
  it('compound unique on (account_id, idempotency_key) prevents duplicate transactions', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('idemp-acct', 'user', 'idemp-user', 100)",
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
         VALUES ('txn-1', 'idemp-acct', 100, -10, 90, 'consumption', 'op-001')`,
      )
      .run();

    // Same account + same idempotency key must fail
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
           VALUES ('txn-2', 'idemp-acct', 90, -10, 80, 'consumption', 'op-001')`,
        )
        .run();
    }).toThrow();

    // Same idempotency key on a DIFFERENT account is allowed
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('idemp-acct-2', 'user', 'idemp-user-2', 100)",
      )
      .run();
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
           VALUES ('txn-3', 'idemp-acct-2', 100, -10, 90, 'consumption', 'op-001')`,
        )
        .run();
    }).not.toThrow();
  });

  it('FK on account_id rejects non-existent account', () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
           VALUES ('txn-fk-fail', 'nonexistent-account', 0, 0, 0, 'adjustment', 'fk-test')`,
        )
        .run();
    }).toThrow();
  });

  it('FK with ON DELETE restrict prevents deleting an account that has transactions', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('restrict-acct', 'user', 'restrict-user', 100)",
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
         VALUES ('restrict-txn', 'restrict-acct', 100, 0, 100, 'adjustment', 'restrict-test')`,
      )
      .run();

    expect(() => {
      sqlite.prepare('DELETE FROM credit_accounts WHERE id = ?').get('restrict-acct');
    }).toThrow();
  });
});

describe('US-006: credit_transactions non-negative balance_before and balance_after', () => {
  it('CHECK rejects negative balance_before', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('neg-before-acct', 'user', 'neg-before-user', 0)",
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
           VALUES ('neg-before-txn', 'neg-before-acct', -10, 10, 0, 'adjustment', 'neg-before-test')`,
        )
        .run();
    }).toThrow();
  });

  it('CHECK rejects negative balance_after', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('neg-after-acct', 'user', 'neg-after-user', 0)",
      )
      .run();

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
           VALUES ('neg-after-txn', 'neg-after-acct', 0, -10, -10, 'consumption', 'neg-after-test')`,
        )
        .run();
    }).toThrow();
  });
});

describe('US-006: credit_transactions immutability', () => {
  it('trigger prevents UPDATE on credit_transactions', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ('immut-acct', 'user', 'immut-user', 100)",
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key)
         VALUES ('immut-txn', 'immut-acct', 100, -10, 90, 'consumption', 'immut-test')`,
      )
      .run();

    expect(() => {
      sqlite
        .prepare('UPDATE credit_transactions SET note = ? WHERE id = ?')
        .run('changed', 'immut-txn');
    }).toThrow();
  });

  it('trigger prevents DELETE on credit_transactions', () => {
    expect(() => {
      sqlite.prepare('DELETE FROM credit_transactions WHERE id = ?').run('immut-txn');
    }).toThrow();
  });
});

// ── credit_rules ──

describe('US-006: credit_rules table structure', () => {
  it('has all required columns after migration', () => {
    const tableInfo = sqlite.prepare('PRAGMA table_info(credit_rules)').all() as { name: string }[];
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('rule_type');
    expect(columnNames).toContain('value');
    expect(columnNames).toContain('version');
    expect(columnNames).toContain('active');
    expect(columnNames).toContain('created_by');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('defaults version to 1, active to true, and value to 0', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_rules (id, rule_type) VALUES ('rule-defaults-test', 'registration_grant')",
      )
      .run();

    const row = sqlite
      .prepare('SELECT value, version, active FROM credit_rules WHERE id = ?')
      .get('rule-defaults-test') as { value: number; version: number; active: number };
    expect(row.value).toBe(0);
    expect(row.version).toBe(1);
    expect(row.active).toBe(1); // SQLite stores boolean as 1
  });
});

describe('US-006: credit_rules supports registration grant and daily limit', () => {
  it('can create a registration_grant rule with positive value', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_rules (id, rule_type, value, version) VALUES ('rule-reg-grant', 'registration_grant', 100, 1)",
      )
      .run();

    const row = sqlite
      .prepare('SELECT rule_type, value FROM credit_rules WHERE id = ?')
      .get('rule-reg-grant') as { rule_type: string; value: number };
    expect(row.rule_type).toBe('registration_grant');
    expect(row.value).toBe(100);
  });

  it('can create a daily_limit_personal rule', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_rules (id, rule_type, value, version) VALUES ('rule-daily-limit', 'daily_limit_personal', 500, 1)",
      )
      .run();

    const row = sqlite
      .prepare('SELECT rule_type, value FROM credit_rules WHERE id = ?')
      .get('rule-daily-limit') as { rule_type: string; value: number };
    expect(row.rule_type).toBe('daily_limit_personal');
    expect(row.value).toBe(500);
  });

  it('can create versioned rules (same rule type with different versions)', () => {
    sqlite
      .prepare(
        "INSERT INTO credit_rules (id, rule_type, value, version, active) VALUES ('rule-v1', 'registration_grant', 100, 1, 0)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO credit_rules (id, rule_type, value, version, active) VALUES ('rule-v2', 'registration_grant', 200, 2, 1)",
      )
      .run();

    const activeRule = sqlite
      .prepare("SELECT value, version FROM credit_rules WHERE id = 'rule-v2'")
      .get() as { value: number; version: number };
    expect(activeRule.value).toBe(200);
    expect(activeRule.version).toBe(2);

    const inactiveRule = sqlite
      .prepare("SELECT value, version, active FROM credit_rules WHERE id = 'rule-v1'")
      .get() as { value: number; version: number; active: number };
    expect(inactiveRule.value).toBe(100);
    expect(inactiveRule.version).toBe(1);
    expect(inactiveRule.active).toBe(0);
  });
});

describe('US-006: credit_rules non-negative value', () => {
  it('CHECK constraint rejects negative value on insert', () => {
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO credit_rules (id, rule_type, value) VALUES ('neg-value-rule', 'registration_grant', -50)",
        )
        .run();
    }).toThrow();
  });
});

describe('US-006: credit_rules FK constraint', () => {
  it('rejects credit_rules with non-existent created_by user', () => {
    expect(() => {
      sqlite
        .prepare(
          "INSERT INTO credit_rules (id, rule_type, value, created_by) VALUES ('fk-fail-rule', 'registration_grant', 100, 'nonexistent-user-id')",
        )
        .run();
    }).toThrow();
  });
});

// ── PG schema verification ──

describe('US-006: PG schema defines credit tables', () => {
  it('pg-schema.ts exports creditAccounts, creditTransactions, and creditRules', async () => {
    const pgSchema = await import('./pg-schema');
    expect(pgSchema.creditAccounts).toBeDefined();
    expect(pgSchema.creditTransactions).toBeDefined();
    expect(pgSchema.creditRules).toBeDefined();
  });
});
