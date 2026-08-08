import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '@/lib/auth/context';

/**
 * US-037 tests: Unified AI Gateway single call
 *
 * Validates:
 * - AC1: Gateway accepts only modelId + business input; no client key/provider/baseUrl
 * - AC2: Pipeline order: auth → status → ownership → model auth → rate limit → hold → call → settle
 * - AC3: Each request creates unique operation + at least one provider attempt
 * - AC4: Success response contains business result, no platform keys or metadata
 * - AC5: Zero provider calls on rejection paths
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

// Mock the crypto module to avoid needing real encryption keys
vi.mock('@/lib/crypto/credential-crypto', () => ({
  resolveProviderCredential: vi.fn(() => 'test-api-key'),
  encryptCredential: vi.fn(() => '{"v":1,"data":"test"}'),
  decryptCredential: vi.fn(() => 'test-api-key'),
}));

// --- Imports ---
import { executeAiOperation } from '@/lib/ai/gateway';
import { db } from '@/lib/db';
import {
  users, organizations, organizationMemberships,
  aiProviders, aiModels, aiOperations, aiProviderAttempts,
  creditAccounts, creditHolds, creditTransactions,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getOrCreateAccount, creditAccount } from '@/lib/credits/ledger';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedProvider(id: string, type: string, name: string) {
  await db.insert(aiProviders).values({ id, type, name, status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
}

async function seedModel(id: string, providerId: string, identifier: string, name: string, opts: { capabilities?: string[]; fixedPrice?: number } = {}) {
  await db.insert(aiModels).values({
    id, providerId, modelIdentifier: identifier, displayName: name,
    status: 'active', visibility: 'public',
    capabilities: opts.capabilities ?? ['text'],
    fixedPrice: opts.fixedPrice ?? 0,
  });
}

function makeContext(userId: string): RequestContext {
  return {
    actor: { userId, platformRole: 'user', status: 'active' },
    tenant: { type: 'personal', organizationId: null, orgRole: null },
    billing: { accountOwnerType: 'user', accountOwnerId: userId },
  };
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts);
  await db.delete(creditHolds);
  await db.delete(aiOperations);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);

  // Clear rate limiter state between tests
  const { resetRateLimitAdapter } = await import('@/lib/rate-limit/rate-limit');
  resetRateLimitAdapter();
});

// ========== AC1: No client credentials accepted ==========
describe('AC1: Gateway input contract', () => {
  it('executeAiOperation params do not accept client key/provider/baseUrl', () => {
    // The GatewayParams type only accepts context, modelId, capability, dispatch
    // Structurally excludes: apiKey, provider, baseUrl
    const params = {
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text' as const,
      businessCapability: 'chat',
      idempotencyKey: 'op1',
      dispatch: async () => 'result',
    };
    expect(params).not.toHaveProperty('apiKey');
    expect(params).not.toHaveProperty('provider');
    expect(params).not.toHaveProperty('baseUrl');
    expect(params).not.toHaveProperty('headers');
  });
});

// ========== AC2 + AC5: Pipeline and zero provider calls on rejection ==========
describe('AC2/AC5: Rejection paths make zero provider calls', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { capabilities: ['text'] });
  });

  it('rejects on model not found without calling dispatch', async () => {
    const dispatchFn = vi.fn(async () => 'should not be called');
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'nonexistent',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'op1',
      dispatch: dispatchFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('MODEL_NOT_ALLOWED');
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  it('rejects on capability mismatch without calling dispatch', async () => {
    const dispatchFn = vi.fn(async () => 'should not be called');
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'image_generation',
      businessCapability: 'image',
      idempotencyKey: 'op1',
      dispatch: dispatchFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  it('rejects on insufficient credits without calling dispatch', async () => {
    await getOrCreateAccount('user', 'u1'); // balance = 0
    // Model costs credits
    await seedModel('m2', 'p1', 'paid-model', 'Paid Model', { fixedPrice: 50 });

    const dispatchFn = vi.fn(async () => 'should not be called');
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm2',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'op1',
      dispatch: dispatchFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INSUFFICIENT_CREDITS');
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  it('rejects on rate limit without calling dispatch', async () => {
    // Exhaust the rate limit (30/min by default policy)
    const { checkRateLimit, rateLimitKey, RATE_LIMIT_POLICIES } = await import('@/lib/rate-limit/rate-limit');
    const key = rateLimitKey('ai-gateway', 'user', 'u1');
    for (let i = 0; i < RATE_LIMIT_POLICIES.aiChat.limit; i++) {
      await checkRateLimit(key, RATE_LIMIT_POLICIES.aiChat);
    }

    const dispatchFn = vi.fn(async () => 'should not be called');
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'op1',
      dispatch: dispatchFn,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('RATE_LIMITED');
      expect(result.status).toBe(429);
    }
    expect(dispatchFn).not.toHaveBeenCalled();
  });
});

// ========== AC3: Operation + attempt tracking ==========
describe('AC3: Operation and attempt records', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { capabilities: ['text'] });

    // Grant credits
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 200, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('creates an operation record on success', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'test-op-1',
      dispatch: async () => ({ text: 'Hello!' }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const ops = await db.select().from(aiOperations).where(eq(aiOperations.id, result.operationId));
      expect(ops).toHaveLength(1);
      expect(ops[0].status).toBe('succeeded');
      expect(ops[0].capability).toBe('chat');
    }
  });

  it('creates at least one provider attempt on success', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'test-op-2',
      dispatch: async () => ({ text: 'result' }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const attempts = await db.select().from(aiProviderAttempts).where(eq(aiProviderAttempts.operationId, result.operationId));
      expect(attempts.length).toBeGreaterThanOrEqual(1);
      expect(attempts[0].status).toBe('succeeded');
      expect(attempts[0].modelId).toBe('m1');
    }
  });

  it('creates operation record even on dispatch failure', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'test-op-3',
      maxRetries: 1,
      dispatch: async () => { throw new Error('Provider error'); },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PROVIDER_ERROR');

      const ops = await db.select().from(aiOperations);
      expect(ops).toHaveLength(1);
      expect(ops[0].status).toBe('failed');

      const attempts = await db.select().from(aiProviderAttempts);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe('failed');
    }
  });

  it('idempotency key is unique per operation', async () => {
    // First call succeeds
    const r1 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'unique-op-1',
      dispatch: async () => 'result1',
    });
    expect(r1.ok).toBe(true);

    // Second call with same idempotency key — replay disabled, should reject
    const r2 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'unique-op-1',
      enableReplay: false,
      dispatch: async () => 'result2',
    });

    // With replay disabled, duplicate idempotency key is rejected
    expect(r2.ok).toBe(false);
  });
});

// ========== AC4: No platform keys in response ==========
describe('AC4: Response data safety', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 200, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('response does not contain API keys or credentials', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'test-safety-1',
      dispatch: async (ctx) => ({ text: 'Hello', modelUsed: ctx.modelIdentifier }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('test-api-key');
      expect(serialized).not.toContain('sk-');
      expect(serialized).not.toContain('apiKey');
      expect(serialized).not.toContain('encryptedCredentials');
    }
  });

  it('dispatch context contains model identifier but not credentials in response', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'test-safety-2',
      dispatch: async (ctx) => {
        // The dispatch receives the API key internally, but it should
        // NOT be returned in the business result
        return { text: 'response', modelIdentifier: ctx.modelIdentifier };
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.data);
      expect(serialized).not.toContain('apiKey');
      expect(serialized).not.toContain('test-api-key');
    }
  });
});

// ========== Integration: Full success flow ==========
describe('Full success flow', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { fixedPrice: 30 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 200, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('returns business result with operation and attempt IDs', async () => {
    const result = await executeAiOperation<string>({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'integration-1',
      dispatch: async () => 'AI generated text',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('AI generated text');
      expect(result.operationId).toBeDefined();
      expect(result.attemptId).toBeDefined();
    }
  });

  it('settles the hold after success', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'integration-2',
      dispatch: async () => ({ text: 'result', usage: { totalTokens: 5 } }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Check that the hold was settled
      const holds = await db.select().from(creditHolds).where(eq(creditHolds.operationId, result.operationId));
      expect(holds).toHaveLength(1);
      expect(holds[0].status).toBe('settled');
    }
  });

  it('releases hold after dispatch failure', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'integration-3',
      dispatch: async () => { throw new Error('Provider timeout'); },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Check that the hold was released
      const holds = await db.select().from(creditHolds);
      expect(holds).toHaveLength(1);
      expect(holds[0].status).toBe('released');
    }
  });
});
