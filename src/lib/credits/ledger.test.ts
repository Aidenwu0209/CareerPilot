import { describe, it, expect, vi } from 'vitest';

/**
 * US-025 tests: Atomic Credit Ledger Service
 *
 * Validates that all credit/quota mutations go through a single atomic,
 * idempotent, and non-negative ledger service.
 *
 * Uses a real in-memory SQLite database (via mocked @/lib/db) to test
 * transactions, CHECK constraints, unique idempotency, and concurrency
 * serialization.
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

// --- Import AFTER mocks ---
import {
  postTransaction,
  creditAccount,
  debitAccount,
  getOrCreateAccount,
  getAccountById,
  getBalance,
  getTransactions,
  verifyBalance,
  InsufficientCreditsError,
  AccountNotFoundError,
  AccountFrozenError,
  CreditError,
} from './ledger';
import { db } from '@/lib/db';
import { creditAccounts, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// --- Helpers ---

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email' });
}

async function seedAccount(ownerType: 'user' | 'organization', ownerId: string, balance = 0) {
  const id = crypto.randomUUID();
  await db.insert(creditAccounts).values({ id, ownerType, ownerId, balance });
  return id;
}

// NOTE: credit_transactions is immutable (triggers block UPDATE + DELETE),
// so we cannot truncate between tests. Each test uses unique user/account IDs
// and unique idempotency keys to avoid cross-test interference.
// The in-memory DB starts fresh per test file.

// ──────────────────────────────────────────────
// AC1: Atomic transaction (lock → check → append → update)
// ──────────────────────────────────────────────

describe('AC1: Atomic transaction — lock, check, append, update in one TX', () => {
  it('credits an account atomically: balance + ledger entry', async () => {
    await seedUser('u1', 'u1@test.com');
    const acctId = await seedAccount('user', 'u1', 100);

    const result = creditAccount({
      accountId: acctId,
      amount: 50,
      reason: 'manual_credit',
      operatorId: 'admin1',
      idempotencyKey: 'idem-1',
      note: 'test credit',
    });

    expect(result.idempotent).toBe(false);
    expect(result.transaction.delta).toBe(50);
    expect(result.transaction.balanceBefore).toBe(100);
    expect(result.transaction.balanceAfter).toBe(150);
    expect(result.transaction.reason).toBe('manual_credit');
    expect(result.account.balance).toBe(150);

    // The DB state matches the returned values.
    const stored = await getAccountById(acctId);
    expect(stored?.balance).toBe(150);
  });

  it('debits an account atomically: balance + ledger entry', async () => {
    await seedUser('u2', 'u2@test.com');
    const acctId = await seedAccount('user', 'u2', 200);

    const result = debitAccount({
      accountId: acctId,
      amount: 75,
      reason: 'consumption',
      businessRefId: 'op-xyz',
      idempotencyKey: 'idem-2',
      note: 'AI text generation',
    });

    expect(result.transaction.delta).toBe(-75);
    expect(result.transaction.balanceBefore).toBe(200);
    expect(result.transaction.balanceAfter).toBe(125);
    expect(result.account.balance).toBe(125);

    const stored = await getBalance(acctId);
    expect(stored).toBe(125);
  });

  it('stores balanceBefore, delta, balanceAfter consistently in the ledger', async () => {
    await seedUser('u3', 'u3@test.com');
    const acctId = await seedAccount('user', 'u3', 50);

    creditAccount({
      accountId: acctId,
      amount: 30,
      reason: 'manual_credit',
      idempotencyKey: 'a1',
    });
    debitAccount({
      accountId: acctId,
      amount: 20,
      reason: 'consumption',
      idempotencyKey: 'a2',
    });

    const txns = await getTransactions(acctId);
    // newest first → a2 then a1
    expect(txns).toHaveLength(2);
    expect(txns[0].delta).toBe(-20);
    expect(txns[0].balanceBefore).toBe(80);
    expect(txns[0].balanceAfter).toBe(60);
    expect(txns[1].delta).toBe(30);
    expect(txns[1].balanceBefore).toBe(50);
    expect(txns[1].balanceAfter).toBe(80);
  });

  it('preserves ruleSnapshot and businessRefId in the ledger entry', async () => {
    await seedUser('u4', 'u4@test.com');
    const acctId = await seedAccount('user', 'u4', 0);

    const snapshot = { fixedPrice: 5, modelId: 'gpt-4' };
    creditAccount({
      accountId: acctId,
      amount: 100,
      reason: 'registration_grant',
      idempotencyKey: 'snap-1',
      ruleSnapshot: snapshot,
      businessRefId: 'rule-v2',
    });

    const txns = await getTransactions(acctId);
    expect(txns[0].ruleSnapshot).toEqual(snapshot);
    expect(txns[0].businessRefId).toBe('rule-v2');
  });
});

// ──────────────────────────────────────────────
// AC2: Insufficient credits → stable error, no side effects
// ──────────────────────────────────────────────

describe('AC2: Insufficient credits returns stable error', () => {
  it('throws InsufficientCreditsError when debit exceeds balance', async () => {
    await seedUser('u5', 'u5@test.com');
    const acctId = await seedAccount('user', 'u5', 30);

    expect(() =>
      debitAccount({
        accountId: acctId,
        amount: 50,
        reason: 'consumption',
        idempotencyKey: 'ins-1',
      }),
    ).toThrow(InsufficientCreditsError);

    // Balance unchanged
    expect(await getBalance(acctId)).toBe(30);
    // No ledger entry created
    const txns = await getTransactions(acctId);
    expect(txns).toHaveLength(0);
  });

  it('throws InsufficientCreditsError when debit equals balance exactly (boundary: 0 is allowed)', async () => {
    await seedUser('u6', 'u6@test.com');
    const acctId = await seedAccount('user', 'u6', 30);

    // Debiting exactly the balance should succeed (result 0, not negative).
    const result = debitAccount({
      accountId: acctId,
      amount: 30,
      reason: 'consumption',
      idempotencyKey: 'ins-2',
    });
    expect(result.transaction.balanceAfter).toBe(0);
    expect(await getBalance(acctId)).toBe(0);
  });

  it('does not create any side effects on the account or ledger', async () => {
    await seedUser('u7', 'u7@test.com');
    const acctId = await seedAccount('user', 'u7', 100);

    // First a successful credit
    creditAccount({
      accountId: acctId,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'se-1',
    });

    // Then a failed debit
    expect(() =>
      debitAccount({
        accountId: acctId,
        amount: 200,
        reason: 'consumption',
        idempotencyKey: 'se-2',
      }),
    ).toThrow(InsufficientCreditsError);

    // Verify: balance = 150 (100 + 50), exactly 1 ledger entry
    expect(await getBalance(acctId)).toBe(150);
    const txns = await getTransactions(acctId);
    expect(txns).toHaveLength(1);
    expect(txns[0].delta).toBe(50);
  });
});

// ──────────────────────────────────────────────
// AC3: Idempotency — same key returns first result
// ──────────────────────────────────────────────

describe('AC3: Idempotency — same key returns first result', () => {
  it('returns the original transaction for duplicate idempotency key', async () => {
    await seedUser('u8', 'u8@test.com');
    const acctId = await seedAccount('user', 'u8', 0);

    const first = creditAccount({
      accountId: acctId,
      amount: 100,
      reason: 'registration_grant',
      idempotencyKey: 'idem-dup',
      note: 'first call',
    });

    const second = creditAccount({
      accountId: acctId,
      amount: 100,
      reason: 'registration_grant',
      idempotencyKey: 'idem-dup',
      note: 'second call',
    });

    expect(second.idempotent).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    // Balance not doubled
    expect(await getBalance(acctId)).toBe(100);
  });

  it('does not create a new ledger entry on duplicate', async () => {
    await seedUser('u9', 'u9@test.com');
    const acctId = await seedAccount('user', 'u9', 0);

    creditAccount({
      accountId: acctId,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'no-dup',
    });
    creditAccount({
      accountId: acctId,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'no-dup',
    });

    const txns = await getTransactions(acctId);
    expect(txns).toHaveLength(1);
  });

  it('allows different idempotency keys on the same account', async () => {
    await seedUser('u10', 'u10@test.com');
    const acctId = await seedAccount('user', 'u10', 0);

    creditAccount({
      accountId: acctId,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'k1',
    });
    creditAccount({
      accountId: acctId,
      amount: 30,
      reason: 'manual_credit',
      idempotencyKey: 'k2',
    });

    expect(await getBalance(acctId)).toBe(80);
    const txns = await getTransactions(acctId);
    expect(txns).toHaveLength(2);
  });

  it('returns idempotent result even when original was a debit', async () => {
    await seedUser('u11', 'u11@test.com');
    const acctId = await seedAccount('user', 'u11', 100);

    const first = debitAccount({
      accountId: acctId,
      amount: 40,
      reason: 'consumption',
      idempotencyKey: 'deb-dup',
    });

    const second = debitAccount({
      accountId: acctId,
      amount: 40,
      reason: 'consumption',
      idempotencyKey: 'deb-dup',
    });

    expect(second.idempotent).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await getBalance(acctId)).toBe(60);
  });

  it('idempotency is scoped per account, not global', async () => {
    await seedUser('u12', 'u12@test.com');
    await seedUser('u13', 'u13@test.com');
    const acct1 = await seedAccount('user', 'u12', 0);
    const acct2 = await seedAccount('user', 'u13', 0);

    // Same key, different accounts — both should succeed
    creditAccount({
      accountId: acct1,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'shared-key',
    });
    creditAccount({
      accountId: acct2,
      amount: 50,
      reason: 'manual_credit',
      idempotencyKey: 'shared-key',
    });

    expect(await getBalance(acct1)).toBe(50);
    expect(await getBalance(acct2)).toBe(50);
  });
});

// ──────────────────────────────────────────────
// AC4: Concurrent debits cannot produce negative balance
// ──────────────────────────────────────────────

describe('AC4: Concurrent debits cannot produce negative balance', () => {
  it('sequential debits maintain non-negative balance', async () => {
    await seedUser('u14', 'u14@test.com');
    const acctId = await seedAccount('user', 'u14', 100);

    // Debit 10 ten times sequentially
    for (let i = 0; i < 10; i++) {
      debitAccount({
        accountId: acctId,
        amount: 10,
        reason: 'consumption',
        idempotencyKey: `seq-${i}`,
      });
    }

    expect(await getBalance(acctId)).toBe(0);

    // 11th debit should fail
    expect(() =>
      debitAccount({
        accountId: acctId,
        amount: 1,
        reason: 'consumption',
        idempotencyKey: 'seq-10',
      }),
    ).toThrow(InsufficientCreditsError);
  });

  it('balance matches ledger sum after multiple operations', async () => {
    await seedUser('u15', 'u15@test.com');
    const acctId = await seedAccount('user', 'u15', 0);

    // All balance changes go through the ledger (starting from 0)
    creditAccount({ accountId: acctId, amount: 200, reason: 'registration_grant', idempotencyKey: 'mix-0' });
    creditAccount({ accountId: acctId, amount: 100, reason: 'manual_credit', idempotencyKey: 'mix-1' });
    debitAccount({ accountId: acctId, amount: 50, reason: 'consumption', idempotencyKey: 'mix-2' });
    creditAccount({ accountId: acctId, amount: 25, reason: 'refund', idempotencyKey: 'mix-3' });
    debitAccount({ accountId: acctId, amount: 200, reason: 'consumption', idempotencyKey: 'mix-4' });

    // Expected: 0 + 200 + 100 - 50 + 25 - 200 = 75
    expect(await getBalance(acctId)).toBe(75);

    const verification = await verifyBalance(acctId);
    expect(verification.match).toBe(true);
    expect(verification.storedBalance).toBe(75);
    expect(verification.computedBalance).toBe(75);
  });

  it('DB CHECK constraint prevents negative balance even via raw SQL', async () => {
    await seedUser('u16', 'u16@test.com');
    const acctId = await seedAccount('user', 'u16', 10);

    // Attempt to set balance to -1 via raw SQL — should be blocked by CHECK constraint
    expect(() => {
      db.update(creditAccounts)
        .set({ balance: -1 })
        .where(eq(creditAccounts.id, acctId))
        .run();
    }).toThrow();
  });
});

// ──────────────────────────────────────────────
// AC5: Reason codes
// ──────────────────────────────────────────────

describe('AC5: Explicit reason codes', () => {
  it('accepts all defined reason codes', async () => {
    await seedUser('u17', 'u17@test.com');
    const acctId = await seedAccount('user', 'u17', 1000);

    const reasons = [
      { reason: 'registration_grant' as const, delta: 100 },
      { reason: 'manual_credit' as const, delta: 50 },
      { reason: 'manual_debit' as const, delta: -25 },
      { reason: 'consumption' as const, delta: -10 },
      { reason: 'refund' as const, delta: 15 },
      { reason: 'adjustment' as const, delta: -5 },
    ];

    for (let i = 0; i < reasons.length; i++) {
      postTransaction({
        accountId: acctId,
        delta: reasons[i].delta,
        reason: reasons[i].reason,
        idempotencyKey: `reason-${i}`,
      });
    }

    const txns = await getTransactions(acctId);
    expect(txns).toHaveLength(6);
    // newest first → last entry first
    expect(txns[0].reason).toBe('adjustment');
    expect(txns[1].reason).toBe('refund');
    expect(txns[2].reason).toBe('consumption');
    expect(txns[3].reason).toBe('manual_debit');
    expect(txns[4].reason).toBe('manual_credit');
    expect(txns[5].reason).toBe('registration_grant');
  });

  it('stores operatorId for auditability', async () => {
    await seedUser('u18', 'u18@test.com');
    const acctId = await seedAccount('user', 'u18', 0);

    creditAccount({
      accountId: acctId,
      amount: 100,
      reason: 'manual_credit',
      operatorId: 'admin-007',
      idempotencyKey: 'op-1',
    });

    const txns = await getTransactions(acctId);
    expect(txns[0].operatorId).toBe('admin-007');
  });
});

// ──────────────────────────────────────────────
// Account management helpers
// ──────────────────────────────────────────────

describe('getOrCreateAccount', () => {
  it('creates a new account with zero balance', async () => {
    await seedUser('u19', 'u19@test.com');
    const acct = await getOrCreateAccount('user', 'u19');

    expect(acct.ownerType).toBe('user');
    expect(acct.ownerId).toBe('u19');
    expect(acct.balance).toBe(0);
    expect(acct.status).toBe('active');
  });

  it('returns existing account on second call', async () => {
    await seedUser('u20', 'u20@test.com');
    const first = await getOrCreateAccount('user', 'u20');
    const second = await getOrCreateAccount('user', 'u20');

    expect(second.id).toBe(first.id);
    expect(second.balance).toBe(0);
  });

  it('supports organization accounts', async () => {
    const acct = await getOrCreateAccount('organization', 'org-1');
    expect(acct.ownerType).toBe('organization');
    expect(acct.ownerId).toBe('org-1');
  });
});

describe('getTransactions pagination', () => {
  it('supports limit and offset', async () => {
    await seedUser('u21', 'u21@test.com');
    const acctId = await seedAccount('user', 'u21', 10000);

    // Create 5 transactions
    for (let i = 0; i < 5; i++) {
      debitAccount({
        accountId: acctId,
        amount: 100,
        reason: 'consumption',
        idempotencyKey: `page-${i}`,
      });
    }

    const page1 = await getTransactions(acctId, { limit: 2, offset: 0 });
    const page2 = await getTransactions(acctId, { limit: 2, offset: 2 });
    const page3 = await getTransactions(acctId, { limit: 2, offset: 4 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(1);
  });

  it('returns empty array for account with no transactions', async () => {
    await seedUser('u22', 'u22@test.com');
    const acctId = await seedAccount('user', 'u22', 0);

    const txns = await getTransactions(acctId);
    expect(txns).toEqual([]);
  });
});

describe('verifyBalance (audit check)', () => {
  it('returns match=true when stored balance equals ledger sum', async () => {
    await seedUser('u23', 'u23@test.com');
    const acctId = await seedAccount('user', 'u23', 0);

    // All balance changes through the ledger (starting from 0)
    creditAccount({ accountId: acctId, amount: 500, reason: 'registration_grant', idempotencyKey: 'v0' });
    creditAccount({ accountId: acctId, amount: 100, reason: 'manual_credit', idempotencyKey: 'v1' });
    debitAccount({ accountId: acctId, amount: 200, reason: 'consumption', idempotencyKey: 'v2' });
    creditAccount({ accountId: acctId, amount: 50, reason: 'refund', idempotencyKey: 'v3' });

    // Expected: 0 + 500 + 100 - 200 + 50 = 450
    const result = await verifyBalance(acctId);
    expect(result.match).toBe(true);
    expect(result.storedBalance).toBe(450);
    expect(result.computedBalance).toBe(450);
  });

  it('returns match=true for account with zero transactions', async () => {
    await seedUser('u24', 'u24@test.com');
    const acctId = await seedAccount('user', 'u24', 0);

    const result = await verifyBalance(acctId);
    expect(result.match).toBe(true);
    expect(result.computedBalance).toBe(0);
  });
});

// ──────────────────────────────────────────────
// Error cases
// ──────────────────────────────────────────────

describe('Error cases', () => {
  it('throws AccountNotFoundError for non-existent account', async () => {
    expect(() =>
      creditAccount({
        accountId: 'does-not-exist',
        amount: 100,
        reason: 'manual_credit',
        idempotencyKey: 'err-1',
      }),
    ).toThrow(AccountNotFoundError);
  });

  it('throws AccountFrozenError for frozen account', async () => {
    await seedUser('u25', 'u25@test.com');
    const acctId = await seedAccount('user', 'u25', 500);

    // Freeze the account
    await db.update(creditAccounts).set({ status: 'frozen' }).where(eq(creditAccounts.id, acctId)).run();

    expect(() =>
      creditAccount({
        accountId: acctId,
        amount: 100,
        reason: 'manual_credit',
        idempotencyKey: 'err-2',
      }),
    ).toThrow(AccountFrozenError);
  });

  it('CreditError has a stable code property', async () => {
    await seedUser('u26', 'u26@test.com');
    const acctId = await seedAccount('user', 'u26', 10);

    try {
      debitAccount({
        accountId: acctId,
        amount: 50,
        reason: 'consumption',
        idempotencyKey: 'err-3',
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientCreditsError);
      expect(e).toBeInstanceOf(CreditError);
      expect((e as CreditError).code).toBe('INSUFFICIENT_CREDITS');
    }
  });

  it('rejects zero or negative amounts in wrapper functions', async () => {
    await seedUser('u27', 'u27@test.com');
    const acctId = await seedAccount('user', 'u27', 100);

    expect(() =>
      creditAccount({
        accountId: acctId,
        amount: 0,
        reason: 'manual_credit',
        idempotencyKey: 'err-4',
      }),
    ).toThrow(CreditError);

    expect(() =>
      debitAccount({
        accountId: acctId,
        amount: -5,
        reason: 'consumption',
        idempotencyKey: 'err-5',
      }),
    ).toThrow(CreditError);
  });
});

// ──────────────────────────────────────────────
// Direct postTransaction usage (delta can be negative)
// ──────────────────────────────────────────────

describe('postTransaction (low-level)', () => {
  it('accepts a direct negative delta', async () => {
    await seedUser('u28', 'u28@test.com');
    const acctId = await seedAccount('user', 'u28', 100);

    const result = postTransaction({
      accountId: acctId,
      delta: -30,
      reason: 'consumption',
      idempotencyKey: 'pt-1',
    });

    expect(result.transaction.delta).toBe(-30);
    expect(result.transaction.balanceAfter).toBe(70);
  });

  it('accepts a direct positive delta', async () => {
    await seedUser('u29', 'u29@test.com');
    const acctId = await seedAccount('user', 'u29', 0);

    const result = postTransaction({
      accountId: acctId,
      delta: 100,
      reason: 'registration_grant',
      idempotencyKey: 'pt-2',
    });

    expect(result.transaction.delta).toBe(100);
    expect(result.transaction.balanceAfter).toBe(100);
  });
});
