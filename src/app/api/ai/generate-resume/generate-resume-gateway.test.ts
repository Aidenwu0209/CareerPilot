import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-041 tests: Generate resume route migrated to unified Gateway
 *
 * Validates:
 * - AC1: Auth required (401 without)
 * - AC2: Success creates resume + sections, returns resumeId/title/sections
 * - AC3: Insufficient credits → 422
 * - AC4: Provider failure → 502
 * - AC5: Client-supplied AI headers ignored (managed credentials used)
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

// Mock the AI SDK
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
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

// --- Helpers ---
async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}

async function seedProviderAndModel() {
  await db.insert(aiProviders).values({
    id: 'p1', type: 'openai', name: 'OpenAI', status: 'active',
    encryptedCredentials: '{"v":1,"data":"test"}',
  });
  await db.insert(aiModels).values({
    id: 'generate-resume-default', providerId: 'p1',
    modelIdentifier: 'gpt-4', displayName: 'GPT-4',
    status: 'active', visibility: 'public', capabilities: ['text'],
    fixedPrice: 10,
  });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

const SAMPLE_GENERATED = {
  personal_info: { fullName: '张三', jobTitle: '前端工程师', email: 'zhangsan@test.com', phone: '13800138000', location: '北京' },
  summary: { text: '资深前端工程师' },
  work_experience: { items: [{ company: '字节跳动', position: '高级前端工程师', startDate: '2020-01', endDate: null, current: true, description: '负责核心产品', highlights: ['提升性能40%'] }] },
  education: { items: [{ institution: '清华大学', degree: '本科', field: '计算机科学', startDate: '2014-09', endDate: '2018-06' }] },
  skills: { categories: [{ name: '编程语言', skills: ['JavaScript', 'TypeScript'] }] },
  projects: { items: [{ name: '在线编辑器', description: '基于Web的IDE', technologies: ['React', 'Node.js'], highlights: ['支持10万用户'] }] },
};

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

describe('US-041: Generate resume via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('generates and creates resume on success', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(SAMPLE_GENERATED),
      usage: { promptTokens: 200, completionTokens: 500, totalTokens: 700 },
    });

    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({
        jobTitle: '前端工程师',
        yearsOfExperience: 3,
        language: 'zh',
      }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.resumeId).toBeDefined();
    expect(data.title).toContain('AI生成简历');
    expect(data.sections).toBeDefined();
    expect(data.sections.length).toBe(6);
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({ jobTitle: 'SWE', yearsOfExperience: 1 }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'generate-resume-default'));

    mockGenerateText.mockResolvedValue({ text: 'should not be called', usage: {} });

    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({ jobTitle: 'SWE', yearsOfExperience: 1 }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(422);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns error on provider failure', async () => {
    setUser('u1');
    mockGenerateText.mockRejectedValue(new Error('Provider API error'));

    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({ jobTitle: 'SWE', yearsOfExperience: 1 }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(502);
  });

  it('ignores client-supplied x-api-key header', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(SAMPLE_GENERATED),
      usage: { promptTokens: 200, completionTokens: 500, totalTokens: 700 },
    });

    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({ jobTitle: 'SWE', yearsOfExperience: 1 }),
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-forged-client-key',
        'x-provider': 'anthropic',
        'x-base-url': 'https://evil.example.com',
      },
    }) as never);

    expect(res.status).toBe(200);
    // Model should be the managed OpenAI model, not the client-specified anthropic
    expect(mockGenerateText).toHaveBeenCalled();
    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.model.modelId).toBe('gpt-4');
  });

  it('rejects invalid input (missing jobTitle)', async () => {
    setUser('u1');
    const res = await POST(new Request('http://localhost/api/ai/generate-resume', {
      method: 'POST',
      body: JSON.stringify({ yearsOfExperience: 1 }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(400);
  });
});
