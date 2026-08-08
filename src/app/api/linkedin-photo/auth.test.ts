import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-020 tests: Protect /api/linkedin-photo with authentication and active status guard
 * Updated for US-049: route now uses unified Gateway
 *
 * Validates:
 * AC2: Unauthenticated access returns 401, no anonymous high-cost calls
 * AC3: Suspended user rejected before external requests
 * AC4: Authenticated existing user still gets response, no provider key exposure
 * AC5: Rejected paths have zero external fetch calls
 */

// ── Mock DB with in-memory SQLite ──

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

// ── Mock auth context for gateway-based route ──

const ctxState = { userId: null as string | null, status: 'active' as string };

vi.mock('@/lib/auth/helpers', () => ({
  resolveUser: vi.fn(),
  getUserIdFromRequest: vi.fn(() => 'test-fp'),
}));

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (!ctxState.userId) return null;
    if (ctxState.status === 'suspended') {
      return { ok: false as const, response: Response.json({ error: 'ACCOUNT_SUSPENDED' }, { status: 403 }) };
    }
    return {
      ok: true as const,
      context: {
        actor: { userId: ctxState.userId, platformRole: 'user', status: ctxState.status as 'active' },
        tenant: { type: 'none' as const, organizationId: null, orgRole: null },
        billing: { accountOwnerType: 'user' as const, accountOwnerId: ctxState.userId },
      },
    };
  }),
}));

// ── Import AFTER mocks ──

import { POST } from './route';
import { db } from '@/lib/db';
import { users, aiProviders, aiModels, creditAccounts, creditTransactions, aiOperations, aiProviderAttempts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { creditAccount, getOrCreateAccount } from '@/lib/credits/ledger';
import { resetRateLimitAdapter } from '@/lib/rate-limit/rate-limit';

// ── Test data ──

const ACTIVE_USER_ID = 'u-active';
const SUSPENDED_USER_ID = 'u-suspended';

// ── Setup ──

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  ctxState.userId = null;
  ctxState.status = 'active';

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

  await db.insert(users).values({
    id: ACTIVE_USER_ID,
    email: 'active@test.com',
    name: 'Active',
    authType: 'oauth',
    platformRole: 'user',
    status: 'active',
  });
  await db.insert(users).values({
    id: SUSPENDED_USER_ID,
    email: 'suspended@test.com',
    name: 'Suspended',
    authType: 'oauth',
    platformRole: 'user',
    status: 'suspended',
  });
  await db.insert(aiProviders).values({
    id: 'p1', type: 'google', name: 'Google', status: 'active',
    encryptedCredentials: '{"v":1,"data":"test"}',
  });
  await db.insert(aiModels).values({
    id: 'linkedin-photo-default', providerId: 'p1',
    modelIdentifier: 'gemini-3.1-flash-image-preview',
    displayName: 'Gemini Flash Image', status: 'active', visibility: 'public',
    capabilities: ['image_generation'], fixedPrice: 10,
  });
  const acct = await getOrCreateAccount('user', ACTIVE_USER_ID);
  creditAccount({ accountId: acct.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'g1', operatorId: 'system' });

  // Spy on global fetch — mock a successful Gemini response
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: 'Here is your photo' },
              { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            ],
          },
        }],
      }),
      { status: 200 },
    ),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function makePostRequest(body: unknown) {
  return new NextRequest(new URL('http://localhost:3000/api/linkedin-photo'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_BODY = {
  image: 'data:image/jpeg;base64,/9j/4AAQ',
  prompt: 'Professional headshot',
};

// ═══════════════════════════════════════════════════

describe('US-020: POST /api/linkedin-photo — authentication guard', () => {
  it('returns 401 when no authenticated user', async () => {
    ctxState.userId = null;
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('makes zero fetch calls when unauthenticated', async () => {
    ctxState.userId = null;
    await POST(makePostRequest(VALID_BODY));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 ACCOUNT_SUSPENDED for suspended user', async () => {
    ctxState.userId = SUSPENDED_USER_ID;
    ctxState.status = 'suspended';
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('ACCOUNT_SUSPENDED');
  });

  it('makes zero fetch calls for suspended user', async () => {
    ctxState.userId = SUSPENDED_USER_ID;
    ctxState.status = 'suspended';
    await POST(makePostRequest(VALID_BODY));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proceeds to generate photo for active user', async () => {
    ctxState.userId = ACTIVE_USER_ID;
    ctxState.status = 'active';
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.image).toBeDefined();
  });

  it('does not expose API key in response', async () => {
    ctxState.userId = ACTIVE_USER_ID;
    ctxState.status = 'active';
    const res = await POST(makePostRequest(VALID_BODY));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('test-api-key');
  });
});
