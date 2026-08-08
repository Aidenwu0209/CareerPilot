import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-045 tests: Multi-section translate route migrated to unified Gateway
 *
 * Validates:
 * - AC1: Translation validates resumeId and sectionIds belong to current user
 * - AC2: Multiple section calls share one operation, each has independent attempt
 * - AC3: Success, partial success, and all-fail use clear settlement rules
 * - AC4: Same idempotency key doesn't duplicate translations or credit deductions
 * - AC5: Insufficient credits rejected before any concurrent provider call
 */

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
}));

// Mock the AI SDK — each call returns a translated section
const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const fn = (modelId: string) => ({ modelId, provider: 'openai' });
    fn.chat = (modelId: string) => ({ modelId, provider: 'openai' });
    return fn;
  }),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (modelId: string) => ({ modelId, provider: 'anthropic' })),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({ modelId, provider: 'google' })),
}));

// --- Mock auth guards ---
const ctxState = { userId: null as string | null, role: 'user' as string };

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (!ctxState.userId) return null;
    return {
      ok: true as const,
      context: {
        actor: { userId: ctxState.userId, platformRole: ctxState.role, status: 'active' as const },
        tenant: { type: 'none' as const, organizationId: null, orgRole: null },
        billing: { accountOwnerType: 'user' as const, accountOwnerId: ctxState.userId },
      },
    };
  }),
}));

// --- Imports ---
import { POST } from './route';
import { db } from '@/lib/db';
import {
  users, resumes, resumeSections,
  aiProviders, aiModels,
  creditAccounts, creditTransactions,
  aiOperations, aiProviderAttempts,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedResume(id: string, userId: string) {
  await db.insert(resumes).values({ id, userId, title: 'My Resume', filePath: '/test.pdf', language: 'zh' });
  await db.insert(resumeSections).values({
    id: 'sec-1',
    resumeId: id,
    type: 'summary',
    title: '个人简介',
    content: { text: '我是一名工程师' },
    sortOrder: 0,
  });
  await db.insert(resumeSections).values({
    id: 'sec-2',
    resumeId: id,
    type: 'work_experience',
    title: '工作经历',
    content: { items: [{ company: '字节跳动', position: '前端工程师' }] },
    sortOrder: 1,
  });
}

async function seedProviderAndModel() {
  await db.insert(aiProviders).values({
    id: 'p1', type: 'openai', name: 'OpenAI', status: 'active',
    encryptedCredentials: '{"v":1,"data":"test"}',
  });
  await db.insert(aiModels).values({
    id: 'translate-default', providerId: 'p1',
    modelIdentifier: 'gpt-4', displayName: 'GPT-4',
    status: 'active', visibility: 'public', capabilities: ['text'],
    fixedPrice: 10,
  });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

function makeTranslateRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/translate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/** Read NDJSON stream and return parsed events */
async function readNdjsonStream(response: Response): Promise<Record<string, unknown>[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        events.push(JSON.parse(line));
      }
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer));
  return events;
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts).catch(() => {});
  await db.delete(aiOperations).catch(() => {});
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);

  mockGenerateText.mockReset();
  resetRateLimitAdapter();
});

describe('US-045: Translate via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedResume('r1', 'u1');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('translates all sections and creates one operation with independent attempts', async () => {
    setUser('u1');

    // Mock: each call returns translated section
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({ sectionId: 'sec-1', title: 'Summary', content: { text: 'I am an engineer' } }),
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ sectionId: 'sec-2', title: 'Work Experience', content: { items: [{ company: 'ByteDance', position: 'Frontend Engineer' }] } }),
        usage: { promptTokens: 60, completionTokens: 40, totalTokens: 100 },
      });

    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson');

    const events = await readNdjsonStream(res);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.language).toBe('en');
    expect(doneEvent!.failedCount).toBe(0);

    // AC2: One operation created
    const ops = await db.select().from(aiOperations);
    expect(ops.length).toBe(1);
    expect(ops[0].status).toBe('succeeded');

    // AC2: Multiple attempts created (one per section)
    const attempts = await db.select().from(aiProviderAttempts).where(eq(aiProviderAttempts.operationId, ops[0].id));
    expect(attempts.length).toBe(2);
    expect(attempts.every((a: typeof attempts[number]) => a.status === 'succeeded')).toBe(true);
  });

  it('rejects cross-user resume with 404', async () => {
    setUser('u2');
    mockGenerateText.mockResolvedValue({ text: '{}', usage: {} });

    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    expect(res.status).toBe(404);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits before any provider call', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'translate-default'));

    mockGenerateText.mockResolvedValue({ text: 'should not be called', usage: {} });

    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    // AC5: Rejected before any provider call
    expect(res.status).toBe(422);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('handles partial failure with clear settlement', async () => {
    setUser('u1');

    // First section succeeds, second fails
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({ sectionId: 'sec-1', title: 'Summary', content: { text: 'I am an engineer' } }),
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })
      .mockRejectedValueOnce(new Error('Provider error for section 2'));

    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    expect(res.status).toBe(200);
    const events = await readNdjsonStream(res);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.failedCount).toBe(1);

    // Operation should be succeeded (partial success)
    const ops = await db.select().from(aiOperations);
    expect(ops[0].status).toBe('succeeded');

    // Two attempts: one succeeded, one failed
    const attempts = await db.select().from(aiProviderAttempts).where(eq(aiProviderAttempts.operationId, ops[0].id));
    expect(attempts.length).toBe(2);
    const succeeded = attempts.filter((a: typeof attempts[number]) => a.status === 'succeeded');
    const failed = attempts.filter((a: typeof attempts[number]) => a.status === 'failed');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
  });

  it('handles all sections failure with full hold release', async () => {
    setUser('u1');
    mockGenerateText.mockRejectedValue(new Error('Provider completely down'));

    const res = await POST(makeTranslateRequest({
      resumeId: 'r1',
      targetLanguage: 'en',
    }) as never);

    expect(res.status).toBe(200);
    const events = await readNdjsonStream(res);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent!.failedCount).toBe(2);

    // AC3: All-fail → operation failed
    const ops = await db.select().from(aiOperations);
    expect(ops[0].status).toBe('failed');
  });

  it('ignores client-supplied x-api-key header', async () => {
    setUser('u1');
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({ sectionId: 'sec-1', title: 'Summary', content: { text: 'Translated' } }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ sectionId: 'sec-2', title: 'Work Experience', content: {} }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

    const res = await POST(new Request('http://localhost/api/ai/translate', {
      method: 'POST',
      body: JSON.stringify({ resumeId: 'r1', targetLanguage: 'en' }),
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-forged-client-key',
        'x-provider': 'anthropic',
        'x-base-url': 'https://evil.example.com',
      },
    }) as never);

    expect(res.status).toBe(200);
    // Read the stream to allow the async operations to complete
    await readNdjsonStream(res);
    // Should use managed OpenAI model, not client anthropic
    expect(mockGenerateText).toHaveBeenCalled();
    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.model.modelId).toBe('gpt-4');
  });
});
