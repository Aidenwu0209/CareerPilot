import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-046 tests: Resume chat route migrated to unified Gateway (streaming + tools)
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

vi.mock('@/lib/db/sample-resume', () => ({ createSampleResume: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/crypto/credential-crypto', () => ({ resolveProviderCredential: vi.fn(() => 'test-api-key') }));

const mockStreamText = vi.fn();
const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  convertToModelMessages: vi.fn(async (msgs: unknown[]) => msgs),
  stepCountIs: vi.fn(() => ({ type: 'stepCount' })),
  tool: (def: unknown) => def,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const fn = (modelId: string) => ({ modelId, provider: 'openai' });
    fn.chat = (modelId: string) => ({ modelId, provider: 'openai' });
    return fn;
  }),
}));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => (modelId: string) => ({ modelId, provider: 'anthropic' })) }));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({ modelId, provider: 'google' })) }));

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

import { POST } from './route';
import { db } from '@/lib/db';
import {
  users, resumes, resumeSections, chatSessions,
  aiProviders, aiModels, aiOperations, aiProviderAttempts,
  creditAccounts, creditTransactions,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}
async function seedResume(id: string, userId: string) {
  await db.insert(resumes).values({ id, userId, title: 'My Resume', filePath: '/test.pdf' });
  await db.insert(resumeSections).values({ id: 'sec-1', resumeId: id, type: 'summary', title: 'Summary', content: { text: 'Engineer' }, sortOrder: 0 });
}
async function seedProviderAndModel() {
  await db.insert(aiProviders).values({ id: 'p1', type: 'openai', name: 'OpenAI', status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
  await db.insert(aiModels).values({ id: 'resume-chat-default', providerId: 'p1', modelIdentifier: 'gpt-4', displayName: 'GPT-4', status: 'active', visibility: 'public', capabilities: ['text'], fixedPrice: 10 });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

function makeFakeUiStream() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts).catch(() => {});
  await db.delete(aiOperations).catch(() => {});
  await db.delete(chatSessions).catch(() => {});
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  mockStreamText.mockReset();
  mockGenerateText.mockReset();
  resetRateLimitAdapter();
});

describe('US-046: Resume chat via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedResume('r1', 'u1');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'g1', operatorId: 'system' });
  });

  it('streams chat response on success', async () => {
    setUser('u1');
    mockStreamText.mockReturnValue({ toUIMessageStream: () => makeFakeUiStream() });

    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello', parts: [{ type: 'text', text: 'Hello' }] }], resumeId: 'r1' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    expect(mockStreamText).toHaveBeenCalled();
  });

  it('rejects cross-user resume with 404', async () => {
    setUser('u2');
    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], resumeId: 'r1' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(404);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [] }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'resume-chat-default'));

    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], resumeId: 'r1' }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(422);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('ignores client-supplied x-api-key header', async () => {
    setUser('u1');
    mockStreamText.mockReturnValue({ toUIMessageStream: () => makeFakeUiStream() });

    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-forged', 'x-provider': 'anthropic', 'x-base-url': 'https://evil.example.com' },
    }) as never);

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    expect(mockStreamText).toHaveBeenCalled();
    const callArg = mockStreamText.mock.calls[0][0];
    expect(callArg.model.modelId).toBe('gpt-4');
  });

  it('works without resumeId (no tools)', async () => {
    setUser('u1');
    mockStreamText.mockReturnValue({ toUIMessageStream: () => makeFakeUiStream() });

    const res = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi', parts: [{ type: 'text', text: 'Hi' }] }] }),
      headers: { 'content-type': 'application/json' },
    }) as never);

    expect(res.status).toBe(200);
    const callArg = mockStreamText.mock.calls[0][0];
    expect(callArg.tools).toBeUndefined();
  });
});
