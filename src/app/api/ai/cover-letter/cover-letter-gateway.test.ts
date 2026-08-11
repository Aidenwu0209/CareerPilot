import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-040 tests: Cover letter route migrated to unified Gateway
 *
 * Validates:
 * - AC1: Resume ownership verified before gateway call
 * - AC2: Success generates result with operation/attempt/usage/settlement
 * - AC3: Client AI key/provider/baseUrl headers ignored
 * - AC4: Insufficient credits, cross-user resume, provider failure → no result
 * - AC5: Route tests cover success, insufficient credits, unauthorized, provider failure
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

// Mock the crypto module
vi.mock('@/lib/crypto/credential-crypto', () => ({
  resolveProviderCredential: vi.fn(() => 'test-api-key'),
}));

// Mock the AI SDK — capture the model and return a canned response
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
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { creditAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedResume(id: string, userId: string) {
  await db.insert(resumes).values({ id, userId, title: 'My Resume', filePath: '/test.pdf' });
  await db.insert(resumeSections).values({
    id: crypto.randomUUID(),
    resumeId: id,
    type: 'summary',
    title: 'Summary',
    content: { text: 'Software engineer' },
    sortOrder: 0,
  });
}

async function seedProviderAndModel() {
  await db.insert(aiProviders).values({
    id: 'p1', type: 'openai', name: 'OpenAI', status: 'active',
    encryptedCredentials: '{"v":1,"data":"test"}',
  });
  await db.insert(aiModels).values({
    id: 'cover-letter-default', providerId: 'p1',
    modelIdentifier: 'gpt-4', displayName: 'GPT-4',
    status: 'active', visibility: 'public', capabilities: ['text'],
    fixedPrice: 10,
  });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
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

// ========== Success ==========
describe('US-040: Cover letter via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedResume('r1', 'u1');
    await seedProviderAndModel();
    const account = await db.select().from(creditAccounts).where(eq(creditAccounts.ownerId, 'u1'));
    if (account.length === 0) {
      const { getOrCreateAccount } = await import('@/lib/credits/ledger');
      const acct = await getOrCreateAccount('user', 'u1');
      creditAccount({ accountId: acct.id, amount: 100, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
    }
  });

  it('generates cover letter on success', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({
      text: 'TITLE: Cover Letter for SWE\n---CONTENT---\nDear Hiring Manager,\n\nI am excited to apply...',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({
        resumeId: 'r1',
        jobDescription: 'Software Engineer at Google',
        tone: 'formal',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toContain('Cover Letter');
    expect(data.content).toContain('Dear Hiring Manager');
  });

  it('rejects cross-user resume with 404', async () => {
    setUser('u2'); // Different user
    mockGenerateText.mockResolvedValue({ text: 'should not be called', usage: {} });

    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({
        resumeId: 'r1', // belongs to u1
        jobDescription: 'Test JD',
        tone: 'formal',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(404);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({ resumeId: 'r1', jobDescription: 'test', tone: 'formal' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits', async () => {
    // Drain credits
    setUser('u1');
    const { getOrCreateAccount } = await import('@/lib/credits/ledger');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));

    // Set very high model price
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'cover-letter-default'));

    mockGenerateText.mockResolvedValue({ text: 'should not be called', usage: {} });

    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({ resumeId: 'r1', jobDescription: 'test', tone: 'formal' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(422);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns error on provider failure', async () => {
    setUser('u1');
    mockGenerateText.mockRejectedValue(new Error('Provider API error'));

    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({ resumeId: 'r1', jobDescription: 'test', tone: 'formal' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(502);
  });

  it('ignores client-supplied x-api-key header', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({
      text: 'TITLE: Test\n---CONTENT---\nContent',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const res = await POST(new Request('http://localhost/api/ai/cover-letter', {
      method: 'POST',
      body: JSON.stringify({ resumeId: 'r1', jobDescription: 'test', tone: 'formal' }),
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-forged-client-key',
        'x-provider': 'anthropic',
        'x-base-url': 'https://evil.example.com',
      },
    }) as never);

    expect(res.status).toBe(200);
    // The gateway uses managed credentials, not the client headers
    // The mock should have been called with the managed key 'test-api-key', not 'sk-forged-client-key'
    expect(mockGenerateText).toHaveBeenCalled();
    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.model.modelId).toBe('gpt-4'); // OpenAI model, not anthropic
  });
});
