import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-048 tests: Interview report route migrated to unified Gateway
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

const mockGenerateText = vi.fn();
vi.mock('ai', () => ({ generateText: (...args: unknown[]) => mockGenerateText(...args) }));

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

import { GET, POST } from './route';
import { db } from '@/lib/db';
import {
  users, interviewSessions, interviewRounds, interviewMessages, interviewReports,
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
  await db.insert(interviewSessions).values({
    id, userId, jobDescription: 'Frontend Engineer', jobTitle: 'FE',
    selectedInterviewers: '[]', status: 'completed',
  });
  await db.insert(interviewRounds).values({
    id: 'round-1', sessionId: id, interviewerType: 'technical',
    interviewerConfig: JSON.stringify({ name: 'Tech Interviewer' }),
    sortOrder: 0, status: 'completed', questionCount: 5, maxQuestions: 10,
  });
  await db.insert(interviewMessages).values({
    id: 'msg-1', roundId: 'round-1', role: 'interviewer', content: 'Tell me about yourself.',
  });
  await db.insert(interviewMessages).values({
    id: 'msg-2', roundId: 'round-1', role: 'candidate', content: 'I am a frontend engineer.',
  });
}
async function seedProviderAndModel() {
  await db.insert(aiProviders).values({ id: 'p1', type: 'openai', name: 'OpenAI', status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
  await db.insert(aiModels).values({ id: 'interview-report-default', providerId: 'p1', modelIdentifier: 'gpt-4', displayName: 'GPT-4', status: 'active', visibility: 'public', capabilities: ['text'], fixedPrice: 10 });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts).catch(() => {});
  await db.delete(aiOperations).catch(() => {});
  await db.delete(interviewReports).catch(() => {});
  await db.delete(interviewMessages).catch(() => {});
  await db.delete(interviewRounds).catch(() => {});
  await db.delete(interviewSessions).catch(() => {});
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  mockGenerateText.mockReset();
  resetRateLimitAdapter();
});

const SAMPLE_REPORT = {
  overallScore: 75,
  dimensionScores: [{ dimension: 'Technical', score: 80, maxScore: 100 }],
  roundEvaluations: [{ roundId: 'round-1', interviewerType: 'technical', interviewerName: 'Tech', score: 75, feedback: 'Good', questions: [{ question: 'Tell me about yourself', answerSummary: 'Engineer', score: 4, highlights: [], weaknesses: [], referenceTips: 'Tip', marked: false, hinted: false, skipped: false }] }],
  overallFeedback: 'Solid candidate.',
  improvementPlan: [{ priority: 'high', area: 'System Design', description: 'Improve', resources: ['DDIA'] }],
};

describe('US-048: Interview report via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedSession('s1', 'u1');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'g1', operatorId: 'system' });
  });

  it('generates report on success', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({ text: JSON.stringify(SAMPLE_REPORT), usage: { promptTokens: 500, completionTokens: 1000, totalTokens: 1500 } });

    const res = await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({ locale: 'zh' }), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.overallScore).toBe(75);
  });

  it('GET returns existing report', async () => {
    setUser('u1');
    mockGenerateText.mockResolvedValue({ text: JSON.stringify(SAMPLE_REPORT), usage: { promptTokens: 10, completionTokens: 5 } });
    await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });

    const res = await GET(new Request('http://localhost/api/interview/s1/report') as never, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.overallScore).toBe(75);
  });

  it('rejects cross-user session with 404', async () => {
    setUser('u2');
    const res = await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(404);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(401);
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'interview-report-default'));
    const res = await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(422);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns error on provider failure', async () => {
    setUser('u1');
    mockGenerateText.mockRejectedValue(new Error('Provider error'));
    const res = await POST(new Request('http://localhost/api/interview/s1/report', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    }) as never, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(502);
    // No report should be saved
    const reports = await db.select().from(interviewReports);
    expect(reports.length).toBe(0);
  });
});
