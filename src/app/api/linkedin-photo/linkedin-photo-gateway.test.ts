import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-049 tests: LinkedIn photo route migrated to unified Gateway
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
vi.mock('@/lib/auth/helpers', () => ({ getUserIdFromRequest: vi.fn(() => 'test-fp') }));

const ctxState = { userId: null as string | null, role: 'user' as string, status: 'active' as string };
vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (!ctxState.userId) return null;
    if (ctxState.status === 'suspended') {
      return { ok: false as const, response: Response.json({ error: 'ACCOUNT_SUSPENDED' }, { status: 403 }) };
    }
    return {
      ok: true as const,
      context: {
        actor: { userId: ctxState.userId, platformRole: ctxState.role, status: ctxState.status as 'active' },
        tenant: { type: 'none' as const, organizationId: null, orgRole: null },
        billing: { accountOwnerType: 'user' as const, accountOwnerId: ctxState.userId },
      },
    };
  }),
}));

import { POST } from './route';
import { db } from '@/lib/db';
import {
  users,
  aiProviders, aiModels, aiOperations, aiProviderAttempts,
  creditAccounts, creditTransactions,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: 'user' });
}
async function seedProviderAndModel() {
  await db.insert(aiProviders).values({ id: 'p1', type: 'google', name: 'Google', status: 'active', encryptedCredentials: '{"v":1,"data":"test"}' });
  await db.insert(aiModels).values({ id: 'linkedin-photo-default', providerId: 'p1', modelIdentifier: 'gemini-3.1-flash-image', displayName: 'Gemini Flash Image', status: 'active', visibility: 'public', capabilities: ['image_generation'], fixedPrice: 10 });
}

function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; ctxState.status = 'active'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.status = 'active'; }
function setSuspended(id: string) { ctxState.userId = id; ctxState.role = 'user'; ctxState.status = 'suspended'; }

const GEMINI_SUCCESS_RESPONSE = {
  candidates: [{
    content: {
      parts: [
        { text: 'Here is your photo' },
        { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
      ],
    },
  }],
};

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/linkedin-photo', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  }) as never;
}

const VALID_BODY = {
  image: 'data:image/jpeg;base64,/9j/4AAQ',
  prompt: 'Professional headshot',
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.restoreAllMocks();
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts).catch(() => {});
  await db.delete(aiOperations).catch(() => {});
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  resetRateLimitAdapter();

  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(GEMINI_SUCCESS_RESPONSE), { status: 200 }),
  );
});

describe('US-049: LinkedIn photo via gateway', () => {
  beforeEach(async () => {
    await seedUser('u1', 'user1@test.com');
    await seedUser('u2', 'user2@test.com');
    await seedProviderAndModel();
    const acct = await getOrCreateAccount('user', 'u1');
    creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'g1', operatorId: 'system' });
  });

  it('generates photo on success', async () => {
    setUser('u1');

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/models/gemini-3.1-flash-image:generateContent');
    const body = await res.json();
    expect(body.image).toBeDefined();
    expect(body.text).toBe('Here is your photo');
  });

  it('rejects unauthenticated user', async () => {
    setUnauth();

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects suspended user', async () => {
    setSuspended('u1');

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns error on insufficient credits', async () => {
    setUser('u1');
    const acct = await getOrCreateAccount('user', 'u1');
    await db.update(creditAccounts).set({ balance: 0 }).where(eq(creditAccounts.id, acct.id));
    await db.update(aiModels).set({ fixedPrice: 99999 }).where(eq(aiModels.id, 'linkedin-photo-default'));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(422);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores client-supplied apiKey and uses managed credentials', async () => {
    setUser('u1');

    const res = await POST(makeRequest(VALID_BODY, { 'x-api-key': 'sk-forged', 'x-provider': 'openai' }));

    expect(res.status).toBe(200);
    // Verify the provider request uses the managed key in a header, never the URL.
    const fetchUrl = fetchSpy.mock.calls[0][0];
    const fetchInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((fetchInit.headers as Record<string, string>)['x-goog-api-key']).toBe('test-api-key');
    expect(String(fetchUrl)).not.toContain('key=');
    expect(String(fetchUrl)).not.toContain('sk-forged');
  });

  it('classifies a rejected provider request without leaking raw details', async () => {
    setUser('u1');
    fetchSpy.mockResolvedValue(new Response('{"error":"bad request secret-value"}', { status: 400 }));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('PROVIDER_REQUEST_REJECTED');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('test-api-key');
    expect(JSON.stringify(body)).not.toContain('secret-value');
  });

  it.each([
    {
      name: 'unavailable model',
      status: 404,
      providerBody: '{"error":{"message":"model gemini-missing not found"}}',
      expectedCode: 'PROVIDER_MODEL_UNAVAILABLE',
      expectedStatus: 502,
    },
    {
      name: 'rejected credentials',
      status: 403,
      providerBody: '{"error":{"message":"API key not valid"}}',
      expectedCode: 'PROVIDER_CREDENTIALS_REJECTED',
      expectedStatus: 502,
    },
    {
      name: 'exhausted quota',
      status: 429,
      providerBody: '{"error":{"message":"RESOURCE_EXHAUSTED: quota exceeded"}}',
      expectedCode: 'PROVIDER_QUOTA_EXCEEDED',
      expectedStatus: 503,
    },
  ])('returns a safe error for $name without retrying', async ({
    status,
    providerBody,
    expectedCode,
    expectedStatus,
  }) => {
    setUser('u1');
    fetchSpy.mockResolvedValue(new Response(providerBody, { status }));

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(expectedStatus);
    expect(await res.json()).toMatchObject({ error: expectedCode });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('validates image MIME and size before gateway call', async () => {
    setUser('u1');

    const res = await POST(makeRequest({ image: 'not-a-data-url', prompt: 'test' }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handles safety filter response', async () => {
    setUser('u1');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ finishReason: 'SAFETY' }],
      }), { status: 200 }),
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('safety_filtered');
  });
});
