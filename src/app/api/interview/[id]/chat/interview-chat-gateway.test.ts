import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-047 tests: Interview chat route migrated to unified Gateway (streaming)
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
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  convertToModelMessages: vi.fn(async (msgs: unknown[]) => msgs),
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
  users, interviewSessions, interviewRounds, interviewMessages,
  aiProviders, aiModels, aiOperations, aiProviderAttempts,
  creditAccounts, creditTransactions,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}
async function seedSession(id: string, userId: string) {
  await db.insert(interviewSessions).values({ id, userId, jobDescription: 'SWE', jobTitle: 'Engineer', selectedInterviewers: '[]', status: 'in_progress' });
  await db.insert(interviewRounds).values({ id: 'round-1', sessionId: id, interviewerType: 'technical', interviewerConfig: { name: 'Interviewer', title: 'Tech Lead', bio: 'Experienced engineer', personality: 'Friendly', style: 'Direct', focusAreas: ['JavaScript', 'React'] }, sortOrder: 0, status: 'in_progress', questionCount: 0, maxQuestions: 10 });
}
async function seedProviderAndModel() {
  await db.insert(aiProviders).values({ id: 'p1', type: 'openai', name: 'OpenAI', status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
  await db.insert(aiModels).values({ id: 'interview-chat-default', providerId: 'p1', modelIdentifier: 'gpt-4', displayName: 'GPT-4', status: 'active', visibility: 'public', capabilities: ['text'], fixedPrice: 10 });
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
  await db.delete(interviewMessages).catch(() => {});
  await db.delete(interviewRounds).catch(() => {});
  await db.delete(interviewSessions).catch(() => {});
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  mockStreamText.mockReset();
  resetRateLimitAdapter();
});

describe('US-047: Interview chat via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedSession('s1', 'u1');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'g1', operatorId: 'system' });
  });

  it('streams interview chat on success', async () => {
    setUser('u1');
    mockStreamText.mockReturnValue({
      toUIMessageStream: () => makeFakeUiStream(),
    });

    const res = await POST(new Request('http://localhost/api/interview/s1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello', parts: [{ type: 'text', text: 'Hello' }] }], roundId: 'round-1', locale: 'zh' }),
      headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    // Read the stream
    const reader = res.body!.getReader();
    await reader.read();
    expect(mockStreamText).toHaveBeenCalled();
  });

  it('rejects cross-user session with 404', async () => {
    setUser('u2');
    const res = await POST(new Request('http://localhost/api/interview/s1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }], roundId: 'round-1' }),
      headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(404);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(new Request('http://localhost/api/interview/s1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [], roundId: 'round-1' }),
      headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'interview-chat-default'));

    const res = await POST(new Request('http://localhost/api/interview/s1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], roundId: 'round-1' }),
      headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(422);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('ignores client-supplied x-api-key header', async () => {
    setUser('u1');
    mockStreamText.mockReturnValue({ toUIMessageStream: () => makeFakeUiStream() });

    const res = await POST(new Request('http://localhost/api/interview/s1/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }], roundId: 'round-1' }),
      headers: { 'content-type': 'application/json', 'x-api-key': 'sk-forged', 'x-provider': 'anthropic' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    expect(mockStreamText).toHaveBeenCalled();
    const callArg = mockStreamText.mock.calls[0][0];
    expect(callArg.model.modelId).toBe('gpt-4');
  });
});
