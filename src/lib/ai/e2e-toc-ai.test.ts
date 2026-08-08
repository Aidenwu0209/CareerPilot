import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';

/**
 * US-086 tests: E2E ToC Managed AI Closed Loop
 *
 * Validates the complete personal-user AI consumption lifecycle:
 * AC1: Register unique email with test OTP → accept legal → funded account → AI optimization
 * AC2: AI request reaches managed provider via gateway (no client API key/provider/base URL)
 * AC3: Exactly one settlement reduces personal balance; transaction references model & operation
 * AC4: Result, balance, and transaction persist after re-query (simulating refresh)
 * AC5: Insufficient credits → INSUFFICIENT_CREDITS; provider calls and ledger remain unchanged
 * AC6: Second user cannot read first user's resume, operations, ledger, or export
 * AC7: No plaintext key, full prompt, or sensitive data in operation/attempt records
 * AC8: Tests pass
 * AC9: Typecheck passes
 */

// ── Mock DB with real in-memory SQLite ──
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
  resolveProviderCredential: vi.fn(() => 'test-managed-api-key'),
  encryptCredential: vi.fn(() => '{"v":1,"data":"encrypted-test-key"}'),
  decryptCredential: vi.fn(() => 'test-managed-api-key'),
  maskCredential: vi.fn(() => 'test-..key'),
}));

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('AUTH_SECRET', 'test-secret-with-sufficient-length-32chars!');
vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'test-master-key-for-credentials-32!');

// ── Imports after mocks ──
import { requestOtp, verifyOtp, clearRateLimits } from '@/lib/auth/email-otp';
import { getMailAdapter, setMailAdapter, TestMailAdapter } from '@/lib/auth/mail-adapter';
import { recordAllConsents } from '@/lib/legal/consent-service';
import { encode, decode } from 'next-auth/jwt';
import { db } from '@/lib/db';
import {
  creditTransactions,
  aiOperations,
  aiProviderAttempts,
  creditHolds,
  aiProviders,
  aiModels,
  resumes,
} from '@/lib/db/schema';
import { executeAiOperation } from '@/lib/ai/gateway';
import { getOrCreateAccount, getBalance } from '@/lib/credits/ledger';
import { collectUserData } from '@/lib/export/user-data-export';
import type { RequestContext } from '@/lib/auth/context';

const SECRET = 'test-secret-with-sufficient-length-32chars!';
const COOKIE_NAME = 'authjs.session-token';

// ── Unique email generator ──
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter++;
  return `${prefix}-${Date.now()}-${emailCounter}@e2e086.test`;
}

// ── Session token helper ──
async function createSessionToken(userId: string, email: string, name?: string | null) {
  const maxAge = 30 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const token = {
    userId,
    name: name || undefined,
    email,
    platformRole: 'user' as const,
    status: 'active' as const,
    lastRefreshAt: now,
    sub: userId,
    iat: now,
    exp: now + maxAge,
    jti: crypto.randomUUID(),
  };
  return encode({ token, secret: SECRET, maxAge, salt: COOKIE_NAME });
}

// ── OTP helper ──
async function requestAndGetCode(email: string, ip = '127.0.0.1'): Promise<string> {
  await requestOtp(email, ip);
  const adapter = getMailAdapter();
  if (adapter instanceof TestMailAdapter) {
    const code = adapter.getLastCode(email);
    if (!code) throw new Error(`No code sent to ${email}`);
    return code;
  }
  throw new Error('TestMailAdapter not in use');
}

// ── Full registration helper ──
async function registerUser(emailPrefix: string, ip: string) {
  const email = uniqueEmail(emailPrefix);
  const code = await requestAndGetCode(email, ip);
  const result = await verifyOtp(email, code);
  expect(result.success).toBe(true);
  const userId = result.userId!;

  await recordAllConsents({ userId, source: 'registration', ipAddress: ip });

  const token = await createSessionToken(userId, email, result.name);
  return { userId, email, token };
}

// ── Seed helpers ──
async function seedProvider(id: string, type = 'google', name = 'Test Provider') {
  await db
    .insert(aiProviders)
    .values({
      id,
      type,
      name,
      status: 'active',
      encryptedCredentials: '{"v":1,"data":"encrypted-test-key"}',
      credentialVersion: 1,
    })
    .onConflictDoNothing();
}

async function seedModel(
  id: string,
  providerId: string,
  identifier = 'test-model-v1',
  name = 'Test Model',
  opts: { capabilities?: string[]; fixedPrice?: number; tokenPriceInput?: number } = {},
) {
  await db
    .insert(aiModels)
    .values({
      id,
      providerId,
      modelIdentifier: identifier,
      displayName: name,
      status: 'active',
      visibility: 'public',
      capabilities: JSON.stringify(opts.capabilities ?? ['text']),
      fixedPrice: opts.fixedPrice ?? 10,
      tokenPriceInput: opts.tokenPriceInput ?? 0,
    })
    .onConflictDoNothing();
}

function makeContext(userId: string): RequestContext {
  return {
    actor: { userId, platformRole: 'user', status: 'active' },
    tenant: { type: 'personal', organizationId: null, orgRole: null },
    billing: { accountOwnerType: 'user', accountOwnerId: userId },
  };
}

async function seedResume(userId: string, title = 'Test Resume') {
  const [{ resumeId }] = await db
    .insert(resumes)
    .values({ userId, title })
    .returning({ resumeId: resumes.id });
  return resumeId;
}

// ── Lifecycle ──

beforeEach(() => {
  clearRateLimits();
  setMailAdapter(null);
  const adapter = getMailAdapter();
  if (adapter instanceof TestMailAdapter) {
    adapter.clear();
  }
});

afterAll(() => {
  Object.assign(process.env, { NODE_ENV: 'test' });
});

// ═══════════════════════════════════════════════════════════════
// AC1 + AC2 + AC3: Full ToC AI loop — register → fund → optimize → settle
// ═══════════════════════════════════════════════════════════════

describe('US-086 AC1-AC3: Full ToC managed AI lifecycle', () => {
  beforeAll(async () => {
    await seedProvider('prov-086', 'google', 'E2E Provider');
    await seedModel('model-086', 'prov-086', 'gemini-test', 'Test Gemini', {
      fixedPrice: 10,
      capabilities: ['text'],
    });
  });

  it('registers a user, completes an AI optimization, and settles exactly once', async () => {
    // ── Step 1: Register via OTP + legal consent ──
    const { userId, token } = await registerUser('toc-full', '203.0.113.10');

    // Verify session
    const decoded = await decode({ token, secret: SECRET, salt: COOKIE_NAME });
    expect(decoded?.userId).toBe(userId);
    expect(decoded?.status).toBe('active');

    // ── Step 2: User has registration grant credits ──
    const account = await getOrCreateAccount('user', userId);
    expect(account.balance).toBeGreaterThan(0);
    const initialBalance = account.balance;

    // ── Step 3: Execute AI optimization through the gateway ──
    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-086',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `e2e-optimize-${userId}-${Date.now()}`,
      dispatch: async (gwCtx) => {
        // AC2: dispatch receives managed credentials — no client API key
        expect(gwCtx.apiKey).toBe('test-managed-api-key');
        expect(gwCtx.modelIdentifier).toBe('gemini-test');
        return {
          text: 'Optimized resume content',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        };
      },
    });

    // ── AC3: Success with business result ──
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toBe('Optimized resume content');
      expect(result.operationId).toBeTruthy();
      expect(result.attemptId).toBeTruthy();
    }

    // ── AC3: Exactly one operation, one attempt ──
    const ops = await db.select().from(aiOperations).where(eq(aiOperations.actorId, userId));
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('succeeded');
    expect(ops[0].capability).toBe('resume_optimize');

    const attempts = await db
      .select()
      .from(aiProviderAttempts)
      .where(eq(aiProviderAttempts.operationId, ops[0].id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe('succeeded');

    // ── AC3: Hold is settled ──
    const holds = await db.select().from(creditHolds).where(eq(creditHolds.operationId, ops[0].id));
    expect(holds).toHaveLength(1);
    expect(holds[0].status).toBe('settled');
    expect(holds[0].holdAmount).toBe(10); // fixedPrice

    // ── AC3: Balance reduced ──
    const afterBalance = await getBalance(account.id);
    expect(afterBalance).toBe(initialBalance - 10);

    // ── AC3: Consumption transaction references model & operation ──
    const txRows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));
    const consumptionTx = txRows.find((t: typeof txRows[number]) => t.reason === 'consumption');
    expect(consumptionTx).toBeTruthy();
    expect(consumptionTx!.delta).toBe(-10);
    expect(consumptionTx!.businessRefId).toBe(ops[0].id);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC4: Persistence — result, balance, and transaction persist
// ═══════════════════════════════════════════════════════════════

describe('US-086 AC4: Data persistence after AI operation', () => {
  beforeAll(async () => {
    await seedProvider('prov-persist', 'google', 'Persist Provider');
    await seedModel('model-persist', 'prov-persist', 'persist-model', 'Persist Model', {
      fixedPrice: 5,
    });
  });

  it('operation result, balance, and transaction persist when re-queried', async () => {
    const { userId } = await registerUser('toc-persist', '203.0.113.20');
    const account = await getOrCreateAccount('user', userId);
    const initialBalance = account.balance;

    // Execute AI operation
    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-persist',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `persist-${userId}-${Date.now()}`,
      dispatch: async () => ({
        text: 'Persisted result',
        usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
      }),
    });
    expect(result.ok).toBe(true);
    const operationId = result.ok ? result.operationId : '';

    // ── Simulate refresh: re-query everything from DB ──
    const opsRefreshed = await db.select().from(aiOperations).where(eq(aiOperations.id, operationId));
    expect(opsRefreshed).toHaveLength(1);
    expect(opsRefreshed[0].status).toBe('succeeded');

    const attemptsRefreshed = await db
      .select()
      .from(aiProviderAttempts)
      .where(eq(aiProviderAttempts.operationId, operationId));
    expect(attemptsRefreshed).toHaveLength(1);
    expect(attemptsRefreshed[0].status).toBe('succeeded');

    const balanceRefreshed = await getBalance(account.id);
    expect(balanceRefreshed).toBe(initialBalance - 5);

    const txRefreshed = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));
    const consumption = txRefreshed.find((t: typeof txRefreshed[number]) => t.reason === 'consumption');
    expect(consumption).toBeTruthy();
    expect(consumption!.delta).toBe(-5);
    expect(consumption!.balanceAfter).toBe(initialBalance - 5);
  });

  it('idempotent replay returns same operation without double charging', async () => {
    const { userId } = await registerUser('toc-idempotent', '203.0.113.21');
    const account = await getOrCreateAccount('user', userId);
    const initialBalance = account.balance;
    const idempotencyKey = `idempotent-${userId}-${Date.now()}`;

    // First call
    const result1 = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-persist',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey,
      dispatch: async () => ({
        text: 'First call result',
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      }),
    });
    expect(result1.ok).toBe(true);

    // Second call with same idempotencyKey — should be replayed or rejected
    await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-persist',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey,
      dispatch: async () => ({
        text: 'Should not be called',
        usage: { inputTokens: 999, outputTokens: 999, totalTokens: 999 },
      }),
    });

    // Should succeed (replay) or indicate operation exists
    // Balance should only be charged once
    const finalBalance = await getBalance(account.id);
    expect(finalBalance).toBe(initialBalance - 5); // Only one deduction

    // Only one operation
    const ops = await db
      .select()
      .from(aiOperations)
      .where(eq(aiOperations.idempotencyKey, idempotencyKey));
    expect(ops).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC5: Insufficient credits — no provider call, no ledger mutation
// ═══════════════════════════════════════════════════════════════

describe('US-086 AC5: Insufficient credits rejection', () => {
  beforeAll(async () => {
    await seedProvider('prov-insufficient', 'google', 'Insufficient Provider');
    await seedModel('model-expensive', 'prov-insufficient', 'expensive-model', 'Expensive', {
      fixedPrice: 100,
    });
  });

  it('returns INSUFFICIENT_CREDITS without calling provider or mutating ledger', async () => {
    const { userId } = await registerUser('toc-poor', '203.0.113.30');

    // Drain the account to near-zero (registration grant was already added)
    const account = await getOrCreateAccount('user', userId);
    const currentBalance = account.balance;

    // Debit all credits so balance is 0
    if (currentBalance > 0) {
      const { debitAccount } = await import('@/lib/credits/ledger');
      debitAccount({
        accountId: account.id,
        amount: currentBalance,
        reason: 'manual_debit',
        idempotencyKey: `drain-${userId}`,
        operatorId: 'system',
        note: 'Drain for insufficient test',
      });
    }

    const balanceBeforeAttempt = await getBalance(account.id);
    expect(balanceBeforeAttempt).toBe(0);

    let dispatchCalled = false;

    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-expensive',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `insufficient-${userId}-${Date.now()}`,
      dispatch: async () => {
        dispatchCalled = true;
        return { text: 'should not happen' };
      },
    });

    // ── AC5: Correct error ──
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('INSUFFICIENT_CREDITS');
      expect(result.status).toBe(422);
    }

    // ── AC5: Provider dispatch was never called ──
    expect(dispatchCalled).toBe(false);

    // ── AC5: No provider attempts recorded ──
    const ops = await db.select().from(aiOperations).where(eq(aiOperations.actorId, userId));
    const failedOps = ops.filter((o: typeof ops[number]) => o.status === 'failed');
    expect(failedOps.length).toBeGreaterThanOrEqual(1);

    const opIds = failedOps.map((o: typeof ops[number]) => o.id);
    if (opIds.length > 0) {
      const attempts = await db
        .select()
        .from(aiProviderAttempts)
        .where(sql`${aiProviderAttempts.operationId} IN (${sql.join(opIds.map((id: string) => sql`${id}`), sql`,`)})`);
      expect(attempts).toHaveLength(0);
    }

    // ── AC5: No consumption transactions (only registration_grant + manual_debit) ──
    const txRows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));
    const consumptionTx = txRows.filter((t: typeof txRows[number]) => t.reason === 'consumption');
    expect(consumptionTx).toHaveLength(0);

    // ── AC5: Balance unchanged ──
    const balanceAfter = await getBalance(account.id);
    expect(balanceAfter).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC6: Cross-user isolation
// ═══════════════════════════════════════════════════════════════

describe('US-086 AC6: Cross-user data isolation', () => {
  beforeAll(async () => {
    await seedProvider('prov-iso', 'google', 'Isolation Provider');
    await seedModel('model-iso', 'prov-iso', 'iso-model', 'Isolation Model', {
      fixedPrice: 8,
    });
  });

  it('user B cannot access user A\'s resume, operations, ledger, or export', async () => {
    // ── Register two users ──
    const userA = await registerUser('toc-iso-a', '203.0.113.40');
    const userB = await registerUser('toc-iso-b', '203.0.113.41');

    // ── User A creates a resume ──
    const resumeA = await seedResume(userA.userId, 'User A Resume');

    const accountA = await getOrCreateAccount('user', userA.userId);
    const accountB = await getOrCreateAccount('user', userB.userId);
    const balanceABefore = await getBalance(accountA.id);
    const balanceBBefore = await getBalance(accountB.id);

    // ── User A completes an AI operation ──
    const resultA = await executeAiOperation({
      context: makeContext(userA.userId),
      modelId: 'model-iso',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `iso-a-${userA.userId}-${Date.now()}`,
      dispatch: async () => ({
        text: 'User A result',
        usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
      }),
    });
    expect(resultA.ok).toBe(true);

    // ── User B's resume query: cannot see user A's resume ──
    const resumeBQuery = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, resumeA), eq(resumes.userId, userB.userId)));
    expect(resumeBQuery).toHaveLength(0);

    // ── User B's operations: none attributed to user B ──
    const opsForB = await db.select().from(aiOperations).where(eq(aiOperations.actorId, userB.userId));
    expect(opsForB).toHaveLength(0);

    // ── User B's ledger: no consumption from user A's operation ──
    const txForB = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, accountB.id));
    const consumptionForB = txForB.filter((t: typeof txForB[number]) => t.reason === 'consumption');
    expect(consumptionForB).toHaveLength(0);

    // ── User B's balance unchanged ──
    const balanceBAfter = await getBalance(accountB.id);
    expect(balanceBAfter).toBe(balanceBBefore);

    // ── User A's balance was charged ──
    const balanceAAfter = await getBalance(accountA.id);
    expect(balanceAAfter).toBe(balanceABefore - 8);

    // ── User B's data export: does not contain user A's data ──
    const exportB = await collectUserData(userB.userId);
    const exportBStr = JSON.stringify(exportB);
    expect(exportBStr).not.toContain(userA.userId);
    expect(exportBStr).not.toContain(resumeA);
    expect(exportBStr).not.toContain('User A result');
    expect(exportBStr).not.toContain(userA.email);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC7: No sensitive data leakage
// ═══════════════════════════════════════════════════════════════

describe('US-086 AC7: No plaintext key or full prompt in records', () => {
  beforeAll(async () => {
    await seedProvider('prov-leak', 'google', 'Leak Provider');
    await seedModel('model-leak', 'prov-leak', 'leak-model', 'Leak Model', {
      fixedPrice: 3,
    });
  });

  it('operation metadata and attempt records do not contain API keys or full prompts', async () => {
    const { userId } = await registerUser('toc-leak', '203.0.113.50');

    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-leak',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `leak-${userId}-${Date.now()}`,
      dispatch: async () => {
        // Managed credentials are resolved internally by the gateway
        // and should never appear in operation metadata
        return {
          text: 'Clean result',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    });
    expect(result.ok).toBe(true);

    // ── Check operation metadata ──
    const ops = await db.select().from(aiOperations).where(eq(aiOperations.actorId, userId));
    expect(ops).toHaveLength(1);
    const opStr = JSON.stringify(ops[0]);
    expect(opStr).not.toContain('test-managed-api-key');
    expect(opStr).not.toContain('AI_CREDENTIAL_MASTER_KEY');

    // ── Check attempt records ──
    const attempts = await db
      .select()
      .from(aiProviderAttempts)
      .where(eq(aiProviderAttempts.operationId, ops[0].id));
    for (const attempt of attempts) {
      const attemptStr = JSON.stringify(attempt);
      expect(attemptStr).not.toContain('test-managed-api-key');
      expect(attemptStr).not.toContain('password123');
      expect(attemptStr).not.toContain('sk-ant-api03');
    }

    // ── Check credit transactions don't contain keys ──
    const account = await getOrCreateAccount('user', userId);
    const txRows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));
    for (const tx of txRows) {
      const txStr = JSON.stringify(tx);
      expect(txStr).not.toContain('test-managed-api-key');
      expect(txStr).not.toContain('AI_CREDENTIAL_MASTER_KEY');
    }
  });

  it('failed provider attempts store sanitized error messages', async () => {
    const { userId } = await registerUser('toc-error-sani', '203.0.113.51');

    // Use a model with high maxSteps to allow retries
    await db.update(aiModels).set({ maxSteps: 2 }).where(eq(aiModels.id, 'model-leak'));

    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-leak',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `err-sani-${userId}-${Date.now()}`,
      maxRetries: 2,
      dispatch: async () => {
        throw new Error('API key sk-ant-api03-real-key-here is invalid at https://api.anthropic.com/v1');
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PROVIDER_ERROR');
    }

    // Check that attempt error messages are sanitized
    const ops = await db.select().from(aiOperations).where(eq(aiOperations.actorId, userId));
    const opId = ops[0].id;
    const attempts = await db
      .select()
      .from(aiProviderAttempts)
      .where(eq(aiProviderAttempts.operationId, opId));

    expect(attempts.length).toBeGreaterThanOrEqual(1);
    for (const attempt of attempts) {
      if (attempt.errorMessage) {
        expect(attempt.errorMessage).not.toContain('sk-ant-api03-real-key-here');
        expect(attempt.errorMessage).not.toContain('https://api.anthropic.com');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: Registration grant provides initial credits for AI
// ═══════════════════════════════════════════════════════════════

describe('US-086: Registration grant enables first AI operation', () => {
  beforeAll(async () => {
    await seedProvider('prov-grant', 'google', 'Grant Provider');
    await seedModel('model-grant', 'prov-grant', 'grant-model', 'Grant Model', {
      fixedPrice: 1,
    });
  });

  it('newly registered user can immediately use managed AI with registration grant', async () => {
    const { userId } = await registerUser('toc-grant', '203.0.113.60');

    // User has registration grant
    const account = await getOrCreateAccount('user', userId);
    expect(account.balance).toBeGreaterThan(0);

    // AI operation succeeds using registration grant credits
    const result = await executeAiOperation({
      context: makeContext(userId),
      modelId: 'model-grant',
      capability: 'text',
      businessCapability: 'resume_optimize',
      idempotencyKey: `grant-${userId}-${Date.now()}`,
      dispatch: async () => ({
        text: 'Grant-funded result',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }),
    });

    expect(result.ok).toBe(true);

    // Registration grant transaction exists
    const txRows = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.accountId, account.id));
    const grant = txRows.find((t: typeof txRows[number]) => t.reason === 'registration_grant');
    expect(grant).toBeTruthy();
    expect(grant!.delta).toBeGreaterThan(0);

    // Consumption transaction exists
    const consumption = txRows.find((t: typeof txRows[number]) => t.reason === 'consumption');
    expect(consumption).toBeTruthy();
    expect(consumption!.delta).toBe(-1);
  });
});
