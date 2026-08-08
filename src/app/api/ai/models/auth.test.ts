import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-020 + US-034 tests: Protect /api/ai/models with authentication and active status guard
 *
 * After US-034, this route returns the server-side managed catalog instead of
 * proxying to upstream providers. These tests validate the auth guard still holds.
 *
 * Validates:
 * AC1 (US-020): Unauthenticated access returns 401
 * AC3 (US-020): Suspended user rejected
 * AC3 (US-034): Active user receives server-managed catalog
 * AC4 (US-034): Response never includes provider keys or internal URLs
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

// ── Mock auth helpers (getUserIdFromRequest returns a fingerprint key) ──

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => 'test-fp'),
  resolveUser: vi.fn(),
}));

// ── Mock guards ──

const ctxState = { userId: null as string | null, role: 'user' as string, status: 'active' as string };

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (!ctxState.userId) return null;
    if (ctxState.status === 'suspended') {
      return {
        ok: false as const,
        response: Response.json({ error: 'ACCOUNT_SUSPENDED' }, { status: 403 }),
      };
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

// ── Import AFTER mocks ──

import { GET } from './route';
import { db } from '@/lib/db';
import { users, aiProviders, aiModels } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

// ── Setup ──

const ACTIVE_USER_ID = 'u-active';
const SUSPENDED_USER_ID = 'u-suspended';

async function seedCatalog() {
  await db.insert(aiProviders).values({
    id: 'prov-1',
    type: 'openai',
    name: 'OpenAI',
    status: 'active',
    encryptedCredentials: 'encrypted-blob',
    credentialVersion: 1,
  });
  await db.insert(aiModels).values({
    id: 'model-1',
    providerId: 'prov-1',
    modelIdentifier: 'gpt-4',
    displayName: 'GPT-4',
    capabilities: ['text'],
    tier: 'standard',
    status: 'active',
    visibility: 'public',
    fixedPrice: 0,
    tokenPriceInput: 10,
    tokenPriceOutput: 30,
  });
  // Disabled model — should NOT appear in user catalog
  await db.insert(aiModels).values({
    id: 'model-2',
    providerId: 'prov-1',
    modelIdentifier: 'gpt-3.5-disabled',
    displayName: 'GPT-3.5 (Disabled)',
    capabilities: ['text'],
    status: 'disabled',
    visibility: 'public',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  ctxState.userId = null;
  ctxState.role = 'user';
  ctxState.status = 'active';

  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiModels);
  await db.delete(aiProviders)
    .catch(() => { /* aiModels cascade may have already removed */ });
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);

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
});

function makeGetRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/ai/models', { headers });
}

// ═══════════════════════════════════════════════════

describe('US-020/034: GET /api/ai/models — auth guard and server catalog', () => {
  it('returns 401 when unauthenticated', async () => {
    ctxState.userId = null;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 403 ACCOUNT_SUSPENDED for suspended user', async () => {
    ctxState.userId = SUSPENDED_USER_ID;
    ctxState.status = 'suspended';
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('ACCOUNT_SUSPENDED');
  });

  it('returns server-managed catalog for active user (no upstream fetch)', async () => {
    await seedCatalog();
    ctxState.userId = ACTIVE_USER_ID;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].modelIdentifier).toBe('gpt-4');
    expect(body.models[0].displayName).toBe('GPT-4');
    expect(body.models[0].capabilities).toEqual(['text']);

    // No upstream fetch — catalog comes from DB
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('excludes disabled models from the catalog', async () => {
    await seedCatalog();
    ctxState.userId = ACTIVE_USER_ID;

    const res = await GET(makeGetRequest());
    const body = await res.json();
    expect(body.models.every((m: { modelIdentifier: string }) => m.modelIdentifier !== 'gpt-3.5-disabled')).toBe(true);
  });

  it('response does not contain provider keys or encrypted credentials', async () => {
    await seedCatalog();
    ctxState.userId = ACTIVE_USER_ID;

    const res = await GET(makeGetRequest());
    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain('encrypted-blob');
    expect(bodyText).not.toContain('credentialVersion');
    expect(bodyText).not.toContain('baseUrl');
    expect(bodyText).not.toContain('encryptedCredentials');
  });

  it('returns empty models list when no models configured', async () => {
    ctxState.userId = ACTIVE_USER_ID;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([]);
  });
});
