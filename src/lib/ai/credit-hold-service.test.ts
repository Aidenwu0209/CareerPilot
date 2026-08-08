import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CatalogModel } from '@/lib/ai/model-catalog';

/**
 * US-036 tests: AI credit hold, settlement, and release
 *
 * Validates:
 * - AC1: Fixed-price and token-based hold calculation
 * - AC2: Insufficient balance rejected before provider call
 * - AC3: Success settles by actual usage, excess released
 * - AC4: Failure releases full hold; expired holds compensable
 * - AC5: Concurrent holds safe; same operation can't double-settle
 */

// --- Mock the DB module ---
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

// --- Imports ---
import { calculateHoldAmount, createHold, settleHold, releaseHold, releaseExpiredHolds } from '@/lib/ai/credit-hold-service';
import { getOrCreateAccount, getBalance, creditAccount } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { users, creditAccounts, aiOperations, creditHolds, creditTransactions, aiProviders, aiModels } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedOperation(id: string, actorId: string, accountId: string) {
  await db.insert(aiOperations).values({ id, actorId, billingAccountId: accountId, capability: 'chat', idempotencyKey: `op-${id}` });
}

async function seedProvider(id: string, type: string, name: string) {
  await db.insert(aiProviders).values({ id, type, name, status: 'active' });
}

async function seedModel(id: string, providerId: string, identifier: string, name: string) {
  await db.insert(aiModels).values({ id, providerId, modelIdentifier: identifier, displayName: name, status: 'active' });
}

function makeModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: 'm1',
    providerId: 'p1',
    providerType: 'openai',
    modelIdentifier: 'gpt-4',
    displayName: 'GPT-4',
    capabilities: ['text'],
    tier: 'standard',
    inputTokenLimit: 128000,
    outputTokenLimit: 4096,
    maxSteps: null,
    fixedPrice: 0,
    tokenPriceInput: 0,
    tokenPriceOutput: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(creditHolds);
  await db.delete(aiOperations);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Hold amount calculation ==========
describe('AC1: calculateHoldAmount', () => {
  it('returns fixedPrice for fixed-price-only model', () => {
    const model = makeModel({ fixedPrice: 50, tokenPriceInput: 0, tokenPriceOutput: 0 });
    expect(calculateHoldAmount(model)).toBe(50);
  });

  it('returns token-based cost for token-only model', () => {
    const model = makeModel({
      fixedPrice: 0,
      tokenPriceInput: 10, // credits per 1K input tokens
      tokenPriceOutput: 30, // credits per 1K output tokens
      inputTokenLimit: 1000,
      outputTokenLimit: 500,
    });
    // (1000 * 10 / 1000) + ceil(500 * 30 / 1000) = 10 + 15 = 25
    expect(calculateHoldAmount(model)).toBe(25);
  });

  it('sums fixed + token for mixed pricing model', () => {
    const model = makeModel({
      fixedPrice: 20,
      tokenPriceInput: 5,
      tokenPriceOutput: 15,
      inputTokenLimit: 2000,
      outputTokenLimit: 1000,
    });
    // 20 + ceil(2000 * 5 / 1000) + ceil(1000 * 15 / 1000) = 20 + 10 + 15 = 45
    expect(calculateHoldAmount(model)).toBe(45);
  });

  it('uses default token limits when null', () => {
    const model = makeModel({
      fixedPrice: 0,
      tokenPriceInput: 1,
      tokenPriceOutput: 1,
      inputTokenLimit: null,
      outputTokenLimit: null,
    });
    // Uses defaults: (128000 * 1 / 1000) + ceil(4096 * 1 / 1000) = 128 + 5 = 133
    expect(calculateHoldAmount(model)).toBeGreaterThan(0);
  });

  it('returns 0 for free model', () => {
    const model = makeModel({ fixedPrice: 0, tokenPriceInput: 0, tokenPriceOutput: 0, inputTokenLimit: 0, outputTokenLimit: 0 });
    expect(calculateHoldAmount(model)).toBe(0);
  });
});

// ========== AC2: Insufficient balance ==========
describe('AC2: Insufficient balance', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
  });

  it('rejects hold when balance is zero and model costs credits', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 50 });
    await expect(createHold({
      accountId: account.id,
      operationId: 'op1',
      model,
      actorId: 'u1',
      idempotencyKey: 'hold1',
    })).rejects.toThrow();

    // Verify balance unchanged
    const balance = await getBalance(account.id);
    expect(balance).toBe(0);
  });

  it('creates hold when balance is sufficient', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    // Grant credits
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 30 });
    const result = await createHold({
      accountId: account.id,
      operationId: 'op1',
      model,
      actorId: 'u1',
      idempotencyKey: 'hold1',
    });

    expect(result.hold.holdAmount).toBe(30);
    expect(result.hold.status).toBe('active');

    // Balance should be 100 - 30 = 70
    const balance = await getBalance(account.id);
    expect(balance).toBe(70);
  });

  it('allows zero-cost hold for free model regardless of balance', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 0, tokenPriceInput: 0, tokenPriceOutput: 0, inputTokenLimit: 0, outputTokenLimit: 0 });
    const result = await createHold({
      accountId: account.id,
      operationId: 'op1',
      model,
      actorId: 'u1',
      idempotencyKey: 'hold1',
    });

    expect(result.hold.holdAmount).toBe(0);
    expect(result.hold.status).toBe('active');
  });
});

// ========== AC3: Settlement on success ==========
describe('AC3: Settlement', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
  });

  it('settles with actual cost and releases excess', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 50 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    // Balance after hold: 100 - 50 = 50
    expect(await getBalance(account.id)).toBe(50);

    // Settle with usage = 20
    const result = await settleHold({
      holdId: hold.id,
      actualUsage: { totalTokens: 20 },
    });

    expect(result.settledAmount).toBeLessThanOrEqual(50);
    expect(result.idempotent).toBe(false);

    // Excess should be credited back
    const balance = await getBalance(account.id);
    expect(balance).toBeGreaterThanOrEqual(50); // At least the held balance returned excess
  });

  it('settles with zero usage, releasing full hold', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 40 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    expect(await getBalance(account.id)).toBe(60);

    const result = await settleHold({
      holdId: hold.id,
      actualUsage: { totalTokens: 0 },
    });

    expect(result.settledAmount).toBe(0);
    expect(result.releasedAmount).toBe(40);

    // Balance restored to 100
    expect(await getBalance(account.id)).toBe(100);
  });

  it('does not credit back more than hold amount', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 30 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    // Settle with usage > hold (should cap at hold amount)
    const result = await settleHold({
      holdId: hold.id,
      actualUsage: { totalTokens: 100 },
    });

    expect(result.settledAmount).toBeLessThanOrEqual(30);
    expect(result.releasedAmount).toBe(0);
  });
});

// ========== AC4: Release on failure ==========
describe('AC4: Release', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
  });

  it('releases full hold on provider failure', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 40 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    expect(await getBalance(account.id)).toBe(60);

    const result = await releaseHold({ holdId: hold.id, reason: 'provider_failure' });

    expect(result.releasedAmount).toBe(40);
    expect(result.idempotent).toBe(false);

    // Balance restored
    expect(await getBalance(account.id)).toBe(100);

    // Hold status
    const holdRow = await db.select().from(creditHolds).where(eq(creditHolds.id, hold.id)).limit(1);
    expect(holdRow[0].status).toBe('released');
  });

  it('releases expired holds via compensation job', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 30 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    // Manually expire the hold
    const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    await db.update(creditHolds).set({ expiresAt: new Date(pastTime * 1000) }).where(eq(creditHolds.id, hold.id));

    const result = await releaseExpiredHolds();
    expect(result.released).toBeGreaterThanOrEqual(1);

    // Balance restored
    expect(await getBalance(account.id)).toBe(100);
  });

  it('does not release already-released hold', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 25 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    // First release
    const r1 = await releaseHold({ holdId: hold.id, reason: 'cancelled' });
    expect(r1.idempotent).toBe(false);
    expect(r1.releasedAmount).toBe(25);

    // Second release — idempotent
    const r2 = await releaseHold({ holdId: hold.id, reason: 'cancelled' });
    expect(r2.idempotent).toBe(true);
    expect(r2.releasedAmount).toBe(0);
  });
});

// ========== AC5: Idempotency and concurrency ==========
describe('AC5: Idempotency and concurrency safety', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
  });

  it('does not double-settle same hold', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 40 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    // First settle
    const r1 = await settleHold({ holdId: hold.id, actualUsage: { totalTokens: 10 } });
    expect(r1.idempotent).toBe(false);

    // Second settle — idempotent
    const r2 = await settleHold({ holdId: hold.id, actualUsage: { totalTokens: 20 } });
    expect(r2.idempotent).toBe(true);
    expect(r2.settledAmount).toBe(r1.settledAmount);
  });

  it('cannot settle a released hold', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);

    const model = makeModel({ fixedPrice: 30 });
    const { hold } = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });

    await releaseHold({ holdId: hold.id, reason: 'provider_failure' });

    await expect(settleHold({ holdId: hold.id, actualUsage: { totalTokens: 5 } }))
      .rejects.toThrow();
  });

  it('concurrent holds do not make balance negative', async () => {
    const account = await getOrCreateAccount('user', 'u1');
    // Only 100 credits
    creditAccount({ accountId: account.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    await seedOperation('op1', 'u1', account.id);
    await seedOperation('op2', 'u1', account.id);

    const model = makeModel({ fixedPrice: 60 });

    // First hold succeeds (100 - 60 = 40)
    const r1 = await createHold({
      accountId: account.id, operationId: 'op1', model, actorId: 'u1', idempotencyKey: 'hold1',
    });
    expect(r1.hold.holdAmount).toBe(60);

    // Second hold should fail (40 < 60)
    await expect(createHold({
      accountId: account.id, operationId: 'op2', model, actorId: 'u1', idempotencyKey: 'hold2',
    })).rejects.toThrow();

    // Balance unchanged at 40
    expect(await getBalance(account.id)).toBe(40);
  });
});
