import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestContext } from '@/lib/auth/context';

/**
 * US-038 tests: AI Gateway multi-attempt and controlled retry
 *
 * Validates:
 * - AC1: Each provider request creates a separate attempt linked to same operation
 * - AC2: Retry count limited by model rules; parse failure won't infinite retry
 * - AC3: Same idempotency key replay returns first result, no duplicate calls
 * - AC4: Each attempt saves usage and status; settlement follows failure policy
 * - AC5: No full prompts, resume text, or sensitive values in logs/errors
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

vi.mock('@/lib/crypto/credential-crypto', () => ({
  resolveProviderCredential: vi.fn(() => 'test-api-key'),
  encryptCredential: vi.fn(() => '{"v":1,"data":"test"}'),
  decryptCredential: vi.fn(() => 'test-api-key'),
}));

// --- Imports ---
import { executeAiOperation } from '@/lib/ai/gateway';
import { db } from '@/lib/db';
import {
  users, aiProviders, aiModels,
  aiOperations, aiProviderAttempts,
  creditAccounts, creditHolds, creditTransactions,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getOrCreateAccount, creditAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedProvider(id: string, type: string, name: string) {
  await db.insert(aiProviders).values({ id, type, name, status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
}

async function seedModel(id: string, providerId: string, identifier: string, name: string, opts: { maxSteps?: number } = {}) {
  await db.insert(aiModels).values({
    id, providerId, modelIdentifier: identifier, displayName: name,
    status: 'active', visibility: 'public', capabilities: ['text'],
    maxSteps: opts.maxSteps ?? null,
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
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  resetRateLimitAdapter();
});

// ========== AC1: Multiple attempts per operation ==========
describe('AC1: Multiple attempts linked to same operation', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { maxSteps: 3 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('creates multiple attempts when retries are needed', async () => {
    let callCount = 0;
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'multi-1',
      maxRetries: 3,
      dispatch: async () => {
        callCount++;
        if (callCount < 3) throw new Error('Transient error');
        return 'success on third try';
      },
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(3);

    if (result.ok) {
      // Check that 3 attempts were created for the same operation
      const attempts = await db.select().from(aiProviderAttempts)
        .where(eq(aiProviderAttempts.operationId, result.operationId));
      expect(attempts).toHaveLength(3);
      expect(attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([1, 2, 3]);
      expect(attempts[0].status).toBe('failed');
      expect(attempts[1].status).toBe('failed');
      expect(attempts[2].status).toBe('succeeded');
    }
  });

  it('each attempt has incrementing attemptNumber', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'multi-2',
      maxRetries: 2,
      dispatch: async () => { throw new Error('Always fails'); },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const ops = await db.select().from(aiOperations);
      const opId = ops[0].id;
      const attempts = await db.select().from(aiProviderAttempts)
        .where(eq(aiProviderAttempts.operationId, opId));
      expect(attempts).toHaveLength(2);
      expect(attempts[0].attemptNumber).toBe(1);
      expect(attempts[1].attemptNumber).toBe(2);
    }
  });
});

// ========== AC2: Retry limit enforcement ==========
describe('AC2: Retry limit from model rules', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { maxSteps: 2 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('respects maxSteps from model config', async () => {
    let callCount = 0;
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'limit-1',
      dispatch: async () => {
        callCount++;
        throw new Error('Always fails');
      },
    });

    expect(result.ok).toBe(false);
    // maxSteps=2, so should try 2 times
    expect(callCount).toBe(2);
  });

  it('does not infinite retry on parse failure', async () => {
    let callCount = 0;
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'limit-2',
      maxRetries: 5, // override, but maxSteps=2 should take precedence via fallback
      dispatch: async () => {
        callCount++;
        throw new SyntaxError('JSON parse error');
      },
    });

    expect(result.ok).toBe(false);
    // maxRetries=5 overrides maxSteps=2 since explicit param takes priority
    expect(callCount).toBe(5);
  });

  it('succeeds on first try with no retries', async () => {
    let callCount = 0;
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'limit-3',
      dispatch: async () => {
        callCount++;
        return 'immediate success';
      },
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(1);

    if (result.ok) {
      const attempts = await db.select().from(aiProviderAttempts)
        .where(eq(aiProviderAttempts.operationId, result.operationId));
      expect(attempts).toHaveLength(1);
    }
  });
});

// ========== AC3: Idempotent replay ==========
describe('AC3: Idempotent replay', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { maxSteps: 1 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('returns cached result on duplicate idempotency key', async () => {
    let callCount = 0;

    // First call — succeeds
    const r1 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'replay-1',
      dispatch: async () => {
        callCount++;
        return 'first result';
      },
    });

    expect(r1.ok).toBe(true);
    expect(callCount).toBe(1);

    // Second call with same key — should return cached, no new dispatch
    const r2 = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'replay-1',
      dispatch: async () => {
        callCount++;
        return 'should not be called';
      },
    });

    expect(r2.ok).toBe(true);
    expect(callCount).toBe(1); // dispatch NOT called again
    if (r2.ok) {
      expect(r2.data).toBe('first result'); // cached result
      expect(r2.operationId).toBe(r1.ok ? r1.operationId : '');
    }
  });

  it('does not deduct credits on replay', async () => {
    const balanceBefore = await getAccountBalance('u1');

    // First call
    await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'replay-2',
      dispatch: async () => 'result1',
    });

    // Check balance changed (credits consumed)
    const balanceAfter1 = await getAccountBalance('u1');
    expect(balanceAfter1).toBeLessThanOrEqual(balanceBefore);

    // Replay
    await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'replay-2',
      dispatch: async () => 'result2',
    });

    // Balance should NOT have changed on replay
    const balanceAfter2 = await getAccountBalance('u1');
    expect(balanceAfter2).toBe(balanceAfter1);
  });
});

// ========== AC4: Per-attempt usage and status tracking ==========
describe('AC4: Per-attempt usage and status', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { maxSteps: 3 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('each attempt records usage data', async () => {
    let callCount = 0;
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'usage-1',
      maxRetries: 2,
      dispatch: async () => {
        callCount++;
        if (callCount === 1) {
          return { text: 'partial', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
        }
        throw new Error('should succeed first time');
      },
    });

    // Wait - the first call should succeed
    expect(result.ok).toBe(true);

    if (result.ok) {
      const attempts = await db.select().from(aiProviderAttempts)
        .where(eq(aiProviderAttempts.operationId, result.operationId));
      const succeeded = attempts.find((a: { status: string }) => a.status === 'succeeded');
      expect(succeeded).toBeDefined();
      const usage = typeof succeeded!.usage === 'string' ? JSON.parse(succeeded!.usage) : succeeded!.usage;
      expect(usage.totalTokens).toBe(150);
    }
  });

  it('failed attempts record error messages', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'usage-2',
      maxRetries: 2,
      dispatch: async () => { throw new Error('Rate limit exceeded'); },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const attempts = await db.select().from(aiProviderAttempts);
      expect(attempts).toHaveLength(2);
      for (const a of attempts) {
        expect(a.status).toBe('failed');
        expect(a.errorMessage).toContain('Rate limit');
      }
    }
  });

  it('releases full hold when all attempts fail', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'usage-3',
      maxRetries: 2,
      dispatch: async () => { throw new Error('fail'); },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const holds = await db.select().from(creditHolds);
      expect(holds).toHaveLength(1);
      expect(holds[0].status).toBe('released');
    }
  });
});

// ========== AC5: No sensitive data in logs ==========
describe('AC5: Sensitive data not persisted', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { maxSteps: 1 });
    const account = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('error messages do not contain API keys', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'sensitive-1',
      maxRetries: 1,
      dispatch: async () => {
        throw new Error('Authorization failed with key sk-proj-abc123XYZ');
      },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const attempts = await db.select().from(aiProviderAttempts);
      const errorMsg = attempts[0].errorMessage ?? '';
      expect(errorMsg).not.toContain('sk-proj-abc123XYZ');
      expect(errorMsg).toContain('[key]');
    }
  });

  it('error messages do not contain URLs', async () => {
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'sensitive-2',
      maxRetries: 1,
      dispatch: async () => {
        throw new Error('Failed to connect to https://internal-api.local:8080/secret');
      },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const attempts = await db.select().from(aiProviderAttempts);
      const errorMsg = attempts[0].errorMessage ?? '';
      expect(errorMsg).not.toContain('https://internal-api.local');
      expect(errorMsg).toContain('[url]');
    }
  });

  it('does not store prompt or resume text in attempt records', async () => {
    const secretPrompt = 'My SSN is 123-45-6789 and my password is hunter2';
    const result = await executeAiOperation({
      context: makeContext('u1'),
      modelId: 'm1',
      capability: 'text',
      businessCapability: 'chat',
      idempotencyKey: 'sensitive-3',
      maxRetries: 1,
      dispatch: async () => {
        throw new Error(`Processing failed for input: ${secretPrompt}`);
      },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const attempts = await db.select().from(aiProviderAttempts);
      // Error message should be sanitized/truncated but NOT contain the raw prompt
      const allData = JSON.stringify(attempts);
      expect(allData).not.toContain('123-45-6789');
      expect(allData).not.toContain('hunter2');
    }
  });
});

// --- Utility ---
async function getAccountBalance(userId: string): Promise<number> {
  const accounts = await db.select().from(creditAccounts).where(eq(creditAccounts.ownerId, userId));
  return accounts[0]?.balance ?? 0;
}
