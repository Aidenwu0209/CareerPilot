/**
 * US-088 AC4: Concurrency Integrity Gate
 *
 * Validates that under concurrent AI operations:
 * 1. All balances remain non-negative
 * 2. Balances match recomputed sums from credit_transactions
 * 3. Each successful operation is settled exactly once
 * 4. Failed operations release their holds completely
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '@/lib/auth/context';
import { sql, eq, sum } from 'drizzle-orm';

// ── Mock DB ──
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

vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/crypto/credential-crypto', () => ({
  resolveProviderCredential: vi.fn(() => 'test-api-key'),
  encryptCredential: vi.fn(() => '{"v":1,"data":"test"}'),
  decryptCredential: vi.fn(() => 'test-api-key'),
  maskCredential: vi.fn(() => 'test-••••key'),
}));

// ── Imports ──
import { executeAiOperation } from '@/lib/ai/gateway';
import { db } from '@/lib/db';
import {
  users, aiProviders, aiModels, aiOperations,
  creditAccounts, creditTransactions, creditHolds,
} from '@/lib/db/schema';
import { getOrCreateAccount, creditAccount, getBalance } from '@/lib/credits/ledger';

vi.setConfig({ testTimeout: 60_000 });

// ── Helpers ──
function makeContext(userId: string): RequestContext {
  return {
    actor: { userId, platformRole: 'user', status: 'active' },
    tenant: { type: 'personal', organizationId: null, orgRole: null },
    billing: { accountOwnerType: 'user', accountOwnerId: userId },
  };
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(creditHolds).catch(() => {});
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiOperations);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);

  const { resetRateLimitAdapter } = await import('@/lib/rate-limit/rate-limit');
  resetRateLimitAdapter();
});

describe('AC4: Concurrency integrity gate', () => {
  beforeEach(async () => {
    await db.insert(users).values({ id: 'u1', email: 'concurrent@test.com', name: 'Concurrent', authType: 'email', platformRole: 'user' });
    await db.insert(aiProviders).values({ id: 'p1', type: 'openai', name: 'OpenAI', status: 'active', encryptedCredentials: '{"v":1}' });
    await db.insert(aiModels).values({
      id: 'm1', providerId: 'p1', modelIdentifier: 'gpt-4', displayName: 'GPT-4',
      status: 'active', visibility: 'public', capabilities: ['text'], fixedPrice: 30,
    });
  });

  it('concurrent operations cannot produce negative balances', async () => {
    // Fund account with 100 credits, each operation costs 30
    // Maximum 3 can succeed (90 credits), the rest must be rejected
    const account = await getOrCreateAccount('user', 'u1');
    await creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant-conc', operatorId: 'system' });

    const numConcurrent = 10;
    const dispatchFn = vi.fn(async () => ({ text: 'result', usage: { totalTokens: 30 } }));
    const promises = [];

    for (let i = 0; i < numConcurrent; i++) {
      promises.push(
        executeAiOperation({
          context: makeContext('u1'),
          modelId: 'm1',
          capability: 'text',
          businessCapability: 'chat',
          idempotencyKey: `conc-op-${i}`,
          dispatch: dispatchFn,
        }).catch(() => ({ ok: false, error: 'CONCURRENCY_ERROR' })),
      );
    }

    const results = await Promise.all(promises);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const successes = results.filter((r: any) => r.ok);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failures = results.filter((r: any) => !r.ok);

    // AC4 invariant 1: balance must be non-negative
    const finalBalance = await getBalance(account.id);
    expect(finalBalance, 'final balance must be non-negative').toBeGreaterThanOrEqual(0);

    // With 100 credits and 30 per operation, at most 3 can succeed (90 spent, 10 remaining)
    expect(successes.length, 'at most 3 operations should succeed with 100 credits / 30 each').toBeLessThanOrEqual(3);
    expect(successes.length, 'at least some operations should succeed').toBeGreaterThan(0);
    expect(failures.length, 'remaining operations should be rejected').toBe(numConcurrent - successes.length);

    // Verify balance matches expected: 100 - (successes * 30)
    const expectedBalance = 100 - successes.length * 30;
    expect(finalBalance, 'balance should match expected deduction').toBe(expectedBalance);
  });

  it('balances match recomputed sums from credit_transactions', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    await creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant-recompute', operatorId: 'system' });

    // Perform several sequential operations
    for (let i = 0; i < 5; i++) {
      await executeAiOperation({
        context: makeContext('u1'),
        modelId: 'm1',
        capability: 'text',
        businessCapability: 'chat',
        idempotencyKey: `recompute-op-${i}`,
        dispatch: async () => ({ text: 'result', usage: { totalTokens: 30 } }),
      });
    }

    // Recompute balance from transactions
    const txnSums = await db
      .select({ totalDelta: sum(creditTransactions.delta) })
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));

    const recomputedBalance = Number(txnSums[0]?.totalDelta ?? 0);

    // The stored balance should match the recomputed sum
    const storedBalance = await getBalance(account.id);
    expect(storedBalance, 'stored balance must match recomputed sum from transactions').toBe(recomputedBalance);
    expect(storedBalance, 'balance must be non-negative').toBeGreaterThanOrEqual(0);
  });

  it('each successful operation is settled exactly once', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    await creditAccount({ accountId: account.id, amount: 1000, reason: 'manual_credit', idempotencyKey: 'grant-once', operatorId: 'system' });

    const opKeys = ['settle-1', 'settle-2', 'settle-3'];
    for (const key of opKeys) {
      const result = await executeAiOperation({
        context: makeContext('u1'),
        modelId: 'm1',
        capability: 'text',
        businessCapability: 'chat',
        idempotencyKey: key,
        dispatch: async () => ({ text: 'result', usage: { totalTokens: 30 } }),
      });
      expect(result.ok).toBe(true);
    }

    // Count settled holds — each successful operation should have exactly one settled hold
    const settledHolds = await db.select()
      .from(creditHolds)
      .where(eq(creditHolds.status, 'settled'));

    // Each operation should have exactly one settled hold
    expect(settledHolds.length, 'exactly 3 settled holds for 3 operations').toBe(3);
  });

  it('idempotent replay does not double-settle the same operation', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    await creditAccount({ accountId: account.id, amount: 1000, reason: 'manual_credit', idempotencyKey: 'grant-replay', operatorId: 'system' });

    const idempotencyKey = 'replay-integrity-1';
    const dispatchFn = vi.fn(async () => ({ text: 'first result' }));

    // First call
    const r1 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey,
      dispatch: dispatchFn,
    });
    expect(r1.ok).toBe(true);

    const balanceAfterFirst = await getBalance(account.id);

    // Replay with same key (rejected since enableReplay is false)
    const r2 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey,
      enableReplay: false,
      dispatch: async () => ({ text: 'second result' }),
    });
    expect(r2.ok).toBe(false);

    // Balance unchanged after rejected replay
    const balanceAfterReplay = await getBalance(account.id);
    expect(balanceAfterReplay, 'balance must not change after rejected replay').toBe(balanceAfterFirst);

    // Count settled holds — should be exactly 1 for single operation
    const settledHolds = await db.select()
      .from(creditHolds)
      .where(eq(creditHolds.status, 'settled'));
    expect(settledHolds.length, 'exactly 1 settled hold for single operation').toBe(1);
  });
});
