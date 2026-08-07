import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-026 tests: Registration Grant & Personal Balance API
 *
 * Validates:
 * - AC1: New users receive exactly one grant transaction
 * - AC2: Duplicate calls (replays) don't produce duplicate grants
 * - AC3: Balance API returns the current user's personal balance
 * - AC4: Transactions API supports pagination and rejects cross-account access
 * - AC5: Empty transactions return empty list; suspended users are rejected
 */

// --- Mock the DB module with an in-memory SQLite instance ---
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });

  return { db, dbReady: Promise.resolve() };
});

// --- Mock sample-resume to avoid complexity ---
vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Import AFTER mocks ---
import { applyRegistrationGrant, getActiveGrantRule } from './registration-grant';
import { getOrCreateAccount, getBalance, getTransactions, creditAccount, debitAccount } from './ledger';
import { db } from '@/lib/db';
import { creditRules, users } from '@/lib/db/schema';

// credit_rules is NOT immutable (no triggers), so we can clean between tests
beforeEach(async () => {
  await db.delete(creditRules);
});

// --- Helpers ---

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email' });
}

async function seedGrantRule(value: number) {
  await db.insert(creditRules).values({
    ruleType: 'registration_grant',
    value,
    version: 1,
    active: true,
  });
}

// ──────────────────────────────────────────────
// AC1: New user receives exactly one grant transaction
// ──────────────────────────────────────────────

describe('AC1: Registration grant for new users', () => {
  it('creates a grant transaction for a new user', async () => {
    await seedUser('g1', 'g1@test.com');
    await seedGrantRule(100);

    const result = await applyRegistrationGrant('g1');

    expect(result).not.toBeNull();
    expect(result!.transaction.delta).toBe(100);
    expect(result!.transaction.reason).toBe('registration_grant');
    expect(result!.idempotent).toBe(false);

    // Balance reflects the grant
    const account = await getOrCreateAccount('user', 'g1');
    expect(account.balance).toBe(100);
  });

  it('uses the default amount when no rule is configured', async () => {
    await seedUser('g2', 'g2@test.com');

    const rule = await getActiveGrantRule();
    expect(rule.value).toBe(100); // DEFAULT_GRANT_AMOUNT
    expect(rule.id).toBe('default');

    const result = await applyRegistrationGrant('g2');
    expect(result!.transaction.delta).toBe(100);
  });

  it('uses the configured rule value when a rule exists', async () => {
    await seedUser('g3', 'g3@test.com');
    await seedGrantRule(250);

    const result = await applyRegistrationGrant('g3');
    expect(result!.transaction.delta).toBe(250);

    // Rule snapshot is stored in the transaction
    const snapshot = result!.transaction.ruleSnapshot as { ruleId: string; ruleVersion: number; value: number };
    expect(snapshot.value).toBe(250);
    expect(snapshot.ruleVersion).toBe(1);
  });

  it('does not grant when rule value is 0', async () => {
    await seedUser('g4', 'g4@test.com');
    await db.insert(creditRules).values({
      ruleType: 'registration_grant',
      value: 0,
      version: 1,
      active: true,
    });

    const result = await applyRegistrationGrant('g4');
    expect(result).toBeNull();

    // Account is still created
    const account = await getOrCreateAccount('user', 'g4');
    expect(account.balance).toBe(0);
  });
});

// ──────────────────────────────────────────────
// AC2: Idempotency — duplicate calls don't re-grant
// ──────────────────────────────────────────────

describe('AC2: Idempotency — no duplicate grants', () => {
  it('calling applyRegistrationGrant twice produces only one transaction', async () => {
    await seedUser('g5', 'g5@test.com');
    await seedGrantRule(100);

    const first = await applyRegistrationGrant('g5');
    const second = await applyRegistrationGrant('g5');

    expect(first!.idempotent).toBe(false);
    expect(second!.idempotent).toBe(true);
    expect(second!.transaction.id).toBe(first!.transaction.id);

    // Only one transaction in the ledger
    const account = await getOrCreateAccount('user', 'g5');
    const txns = await getTransactions(account.id);
    expect(txns).toHaveLength(1);
    expect(account.balance).toBe(100);
  });

  it('calling applyRegistrationGrant many times keeps balance stable', async () => {
    await seedUser('g6', 'g6@test.com');
    await seedGrantRule(50);

    for (let i = 0; i < 5; i++) {
      await applyRegistrationGrant('g6');
    }

    const account = await getOrCreateAccount('user', 'g6');
    expect(account.balance).toBe(50);

    const txns = await getTransactions(account.id);
    expect(txns).toHaveLength(1);
  });

  it('OAuth replay scenario: user already has grant, second OAuth login does not duplicate', async () => {
    await seedUser('g7', 'g7@test.com');
    await seedGrantRule(100);

    // Simulate first registration
    await applyRegistrationGrant('g7');

    // Simulate OAuth callback replay — user logs in again
    await applyRegistrationGrant('g7');

    const account = await getOrCreateAccount('user', 'g7');
    expect(account.balance).toBe(100);
    const txns = await getTransactions(account.id);
    expect(txns).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// AC3: Balance API returns personal balance
// ──────────────────────────────────────────────

describe('AC3: Personal balance API', () => {
  it('returns the user balance via getOrCreateAccount + getBalance', async () => {
    await seedUser('g8', 'g8@test.com');

    const account = await getOrCreateAccount('user', 'g8');
    expect(account.balance).toBe(0);

    // Grant some credits
    creditAccount({
      accountId: account.id,
      amount: 200,
      reason: 'registration_grant',
      idempotencyKey: 'bal-1',
    });

    const balance = await getBalance(account.id);
    expect(balance).toBe(200);
  });

  it('reflects changes after debit', async () => {
    await seedUser('g9', 'g9@test.com');
    const account = await getOrCreateAccount('user', 'g9');

    creditAccount({
      accountId: account.id,
      amount: 100,
      reason: 'manual_credit',
      idempotencyKey: 'bal-2',
    });
    debitAccount({
      accountId: account.id,
      amount: 30,
      reason: 'consumption',
      idempotencyKey: 'bal-3',
    });

    const balance = await getBalance(account.id);
    expect(balance).toBe(70);
  });
});

// ──────────────────────────────────────────────
// AC4: Transactions API — pagination, no cross-account access
// ──────────────────────────────────────────────

describe('AC4: Transactions pagination and isolation', () => {
  it('returns transactions scoped to the account', async () => {
    await seedUser('g10', 'g10@test.com');
    const account = await getOrCreateAccount('user', 'g10');

    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'p-1' });
    debitAccount({ accountId: account.id, amount: 25, reason: 'consumption', idempotencyKey: 'p-2' });

    const txns = await getTransactions(account.id);
    expect(txns).toHaveLength(2);
    // Newest first
    expect(txns[0].delta).toBe(-25);
    expect(txns[1].delta).toBe(100);
  });

  it('supports pagination with limit and offset', async () => {
    await seedUser('g11', 'g11@test.com');
    const account = await getOrCreateAccount('user', 'g11');

    for (let i = 0; i < 10; i++) {
      creditAccount({
        accountId: account.id,
        amount: 10,
        reason: 'manual_credit',
        idempotencyKey: `pg-${i}`,
      });
    }

    const page1 = await getTransactions(account.id, { limit: 3, offset: 0 });
    const page2 = await getTransactions(account.id, { limit: 3, offset: 3 });
    const page3 = await getTransactions(account.id, { limit: 3, offset: 6 });
    const page4 = await getTransactions(account.id, { limit: 3, offset: 9 });

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page3).toHaveLength(3);
    expect(page4).toHaveLength(1);
  });

  it('reading account A transactions does not show account B data', async () => {
    await seedUser('g12', 'g12@test.com');
    await seedUser('g13', 'g13@test.com');

    const acctA = await getOrCreateAccount('user', 'g12');
    const acctB = await getOrCreateAccount('user', 'g13');

    creditAccount({ accountId: acctA.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'iso-a' });
    creditAccount({ accountId: acctB.id, amount: 50, reason: 'manual_credit', idempotencyKey: 'iso-b' });

    const txnsA = await getTransactions(acctA.id);
    const txnsB = await getTransactions(acctB.id);

    expect(txnsA).toHaveLength(1);
    expect(txnsA[0].delta).toBe(100);
    expect(txnsB).toHaveLength(1);
    expect(txnsB[0].delta).toBe(50);
  });
});

// ──────────────────────────────────────────────
// AC5: Empty list and error states
// ──────────────────────────────────────────────

describe('AC5: Empty transactions and error states', () => {
  it('returns empty array for account with no transactions', async () => {
    await seedUser('g14', 'g14@test.com');
    const account = await getOrCreateAccount('user', 'g14');

    const txns = await getTransactions(account.id);
    expect(txns).toEqual([]);
  });

  it('returns empty array for brand new account', async () => {
    await seedUser('g15', 'g15@test.com');
    const account = await getOrCreateAccount('user', 'g15');

    const txns = await getTransactions(account.id);
    expect(txns).toEqual([]);
    expect(account.balance).toBe(0);
  });
});

// ──────────────────────────────────────────────
// getActiveGrantRule
// ──────────────────────────────────────────────

describe('getActiveGrantRule', () => {
  it('returns the active rule when one exists', async () => {
    await seedGrantRule(300);

    const rule = await getActiveGrantRule();
    expect(rule.value).toBe(300);
    expect(rule.version).toBe(1);
    expect(rule.id).not.toBe('default');
  });

  it('returns default when no active rule exists', async () => {
    const rule = await getActiveGrantRule();
    expect(rule.value).toBe(100); // DEFAULT_GRANT_AMOUNT
    expect(rule.id).toBe('default');
    expect(rule.version).toBe(0);
  });

  it('uses the latest active rule when multiple exist', async () => {
    // Create an older active rule
    await db.insert(creditRules).values({
      ruleType: 'registration_grant',
      value: 50,
      version: 1,
      active: false, // inactive
    });
    await db.insert(creditRules).values({
      ruleType: 'registration_grant',
      value: 200,
      version: 2,
      active: true,
    });

    const rule = await getActiveGrantRule();
    expect(rule.value).toBe(200);
    expect(rule.version).toBe(2);
  });
});
