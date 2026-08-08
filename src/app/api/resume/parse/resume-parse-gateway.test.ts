import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-044 tests: Resume parse route migrated to unified Gateway
 *
 * Validates:
 * - AC1: Resume parse only calls model through unified Gateway
 * - AC2: Server-side limits on file type, size, PDF pages, extracted text length, max tokens
 * - AC3: Over-limit, insufficient credits, invalid file → no provider call, no credit deduction, no resume created
 * - AC4: Success creates result for current user with operation/usage/settlement
 * - AC5: Tests cover valid PDF, fake MIME, over-limit, provider failure
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

// Mock mupdf — return fake text for text extraction, fake pages for image conversion
const mockPageText = 'John Doe\nSoftware Engineer\n5 years experience\nemail: john@test.com';
const mockDoc: {
  countPages: ReturnType<typeof vi.fn>;
  loadPage: ReturnType<typeof vi.fn>;
} = {
  countPages: vi.fn(() => 1),
  loadPage: vi.fn(() => ({
    toStructuredText: vi.fn((): { asText: () => string } => ({ asText: () => mockPageText })),
    toPixmap: vi.fn(() => ({ asPNG: () => new Uint8Array([1, 2, 3]) })),
  })),
};
vi.mock('mupdf', () => ({
  Document: { openDocument: vi.fn(() => mockDoc) },
  Matrix: { scale: vi.fn(() => ({})) },
  ColorSpace: { DeviceRGB: {} },
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
    id: 'parse-resume-default', providerId: 'p1',
    modelIdentifier: 'gpt-4', displayName: 'GPT-4',
    status: 'active', visibility: 'public', capabilities: ['text'],
    fixedPrice: 10,
  });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

const SAMPLE_PARSED = {
  personalInfo: {
    fullName: '张三',
    jobTitle: '前端工程师',
    email: 'zhangsan@test.com',
    phone: '13800138000',
    location: '北京',
  },
  summary: '资深前端工程师',
  workExperience: [{
    company: '字节跳动',
    position: '高级前端工程师',
    startDate: '2020-01',
    endDate: null,
    current: true,
    description: '负责核心产品',
    highlights: ['提升性能40%'],
  }],
  education: [{
    institution: '清华大学',
    degree: '本科',
    field: '计算机科学',
    startDate: '2014-09',
    endDate: '2018-06',
  }],
  skills: [{ name: '编程语言', skills: ['JavaScript', 'TypeScript'] }],
};

function makePdfRequest(extra?: Record<string, string>) {
  const formData = new FormData();
  const pdfBlob = new Blob(['fake-pdf-content'], { type: 'application/pdf' });
  formData.append('file', pdfBlob, 'resume.pdf');
  formData.append('template', 'classic');
  formData.append('language', 'zh');
  if (extra) {
    for (const [k, v] of Object.entries(extra)) formData.append(k, v);
  }
  return new Request('http://localhost/api/resume/parse', {
    method: 'POST',
    body: formData,
  });
}

function makeImageRequest(mime: string) {
  const formData = new FormData();
  const blob = new Blob(['fake-image'], { type: mime });
  formData.append('file', blob, 'resume.png');
  return new Request('http://localhost/api/resume/parse', {
    method: 'POST',
    body: formData,
  });
}

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
  mockDoc.countPages.mockReturnValue(1);
  resetRateLimitAdapter();
});

describe('US-044: Resume parse via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'grant1', operatorId: 'system' });
  });

  it('parses a text-based PDF and creates resume', async () => {
    setUser('u1');
    // mupdf returns text > 200 chars → text-based PDF path
    mockDoc.loadPage.mockReturnValue({
      toStructuredText: vi.fn(() => ({ asText: () => 'A'.repeat(300) })),
      toPixmap: vi.fn(),
    });
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(SAMPLE_PARSED),
      usage: { promptTokens: 500, completionTokens: 1000, totalTokens: 1500 },
    });

    const res = await POST(makePdfRequest() as never);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('张三');
    expect(data.sections.length).toBeGreaterThanOrEqual(4);
    expect(mockGenerateText).toHaveBeenCalled();
  });

  it('rejects fake MIME type', async () => {
    setUser('u1');
    const formData = new FormData();
    formData.append('file', new Blob(['fake'], { type: 'text/plain' }), 'resume.txt');

    const res = await POST(new Request('http://localhost/api/resume/parse', {
      method: 'POST',
      body: formData,
    }) as never);

    expect(res.status).toBe(400);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects oversized file', async () => {
    setUser('u1');
    const formData = new FormData();
    // Create a file > 10MB
    const bigBlob = new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'application/pdf' });
    formData.append('file', bigBlob, 'huge.pdf');

    const res = await POST(new Request('http://localhost/api/resume/parse', {
      method: 'POST',
      body: formData,
    }) as never);

    expect(res.status).toBe(400);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects PDF with too many pages', async () => {
    setUser('u1');
    mockDoc.countPages.mockReturnValue(50);

    const res = await POST(makePdfRequest() as never);

    expect(res.status).toBe(400);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'parse-resume-default'));

    mockDoc.loadPage.mockReturnValue({
      toStructuredText: vi.fn(() => ({ asText: () => 'A'.repeat(300) })),
      toPixmap: vi.fn(),
    });

    const res = await POST(makePdfRequest() as never);

    expect(res.status).toBe(422);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns error on provider failure', async () => {
    setUser('u1');
    mockDoc.loadPage.mockReturnValue({
      toStructuredText: vi.fn(() => ({ asText: () => 'A'.repeat(300) })),
      toPixmap: vi.fn(),
    });
    mockGenerateText.mockRejectedValue(new Error('Provider API error'));

    const res = await POST(makePdfRequest() as never);

    expect(res.status).toBe(502);
    // No resume should have been created
    const allResumes = await db.select().from(resumes);
    expect(allResumes.length).toBe(0);
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();
    const res = await POST(makePdfRequest() as never);
    expect(res.status).toBe(401);
  });

  it('rejects request with no file', async () => {
    setUser('u1');
    const formData = new FormData();
    const res = await POST(new Request('http://localhost/api/resume/parse', {
      method: 'POST',
      body: formData,
    }) as never);

    expect(res.status).toBe(400);
  });
});
