import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-050: Replace model proxy and reject legacy client AI config
 *
 * Validates:
 * AC1: /api/ai/models reads only from server-side catalog, filtered by account permissions
 * AC2: Endpoint does not read x-api-key/x-provider/x-base-url or fetch client URLs
 * AC3: Legacy headers and body apiKey are detected, ignored, and logged with sanitized warning
 * AC4: Catalog returns only modelId, display name, capabilities, and public pricing
 * AC5: Disabled models disappear from catalog; directly submitting their ID is rejected
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

// ── Mock auth helpers ──

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => 'test-fp'),
  resolveUser: vi.fn(),
}));

// ── Mock guards ──

const ctxState = { userId: 'u-active' as string | null, role: 'user' as string, status: 'active' as string };

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
import { validateModelAccess } from '@/lib/ai/model-catalog';

// ── Setup ──

const ACTIVE_USER_ID = 'u-active';

async function seedFullCatalog() {
  await db.insert(aiProviders).values([
    {
      id: 'prov-active',
      type: 'openai',
      name: 'OpenAI Active',
      status: 'active',
      encryptedCredentials: 'enc-1',
      credentialVersion: 1,
    },
    {
      id: 'prov-disabled',
      type: 'gemini',
      name: 'Gemini Disabled',
      status: 'disabled',
      encryptedCredentials: 'enc-2',
      credentialVersion: 1,
    },
  ]);

  await db.insert(aiModels).values([
    {
      id: 'model-active-text',
      providerId: 'prov-active',
      modelIdentifier: 'gpt-4-active',
      displayName: 'GPT-4 Active',
      capabilities: ['text'],
      tier: 'standard',
      status: 'active',
      visibility: 'public',
      fixedPrice: 0,
      tokenPriceInput: 10,
      tokenPriceOutput: 30,
    },
    {
      id: 'model-active-image',
      providerId: 'prov-active',
      modelIdentifier: 'dall-e-3',
      displayName: 'DALL-E 3',
      capabilities: ['image_generation'],
      tier: 'premium',
      status: 'active',
      visibility: 'public',
      fixedPrice: 15,
      tokenPriceInput: 0,
      tokenPriceOutput: 0,
    },
    {
      id: 'model-disabled',
      providerId: 'prov-active',
      modelIdentifier: 'gpt-3.5-disabled',
      displayName: 'GPT-3.5 (Disabled)',
      capabilities: ['text'],
      tier: 'basic',
      status: 'disabled',
      visibility: 'public',
      fixedPrice: 0,
      tokenPriceInput: 5,
      tokenPriceOutput: 15,
    },
    {
      id: 'model-private',
      providerId: 'prov-active',
      modelIdentifier: 'gpt-4-private',
      displayName: 'GPT-4 Private',
      capabilities: ['text'],
      tier: 'enterprise',
      status: 'active',
      visibility: 'private',
      fixedPrice: 0,
      tokenPriceInput: 20,
      tokenPriceOutput: 60,
    },
    {
      id: 'model-from-disabled-provider',
      providerId: 'prov-disabled',
      modelIdentifier: 'gemini-pro',
      displayName: 'Gemini Pro',
      capabilities: ['text'],
      tier: 'standard',
      status: 'active',
      visibility: 'public',
      fixedPrice: 0,
      tokenPriceInput: 8,
      tokenPriceOutput: 24,
    },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  ctxState.userId = ACTIVE_USER_ID;
  ctxState.role = 'user';
  ctxState.status = 'active';

  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiModels);
  await db.delete(aiProviders).catch(() => {});
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
});

function makeGetRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/ai/models', { headers });
}

// ═══════════════════════════════════════════════════

describe('US-050: Replace model proxy and reject legacy client AI config', () => {
  describe('AC1+AC2: Server-side catalog only, no client URL fetching', () => {
    it('returns catalog from DB, never calls fetch', async () => {
      await seedFullCatalog();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const res = await GET(makeGetRequest());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.models.length).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('ignores x-api-key/x-provider/x-base-url headers — no fetch to client URL', async () => {
      await seedFullCatalog();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const res = await GET(
        makeGetRequest({
          'x-api-key': 'sk-fake-client-key',
          'x-provider': 'openai',
          'x-base-url': 'https://evil.client-controlled.example.com',
        }),
      );
      expect(res.status).toBe(200);

      // Must not have fetched any client-controlled URL
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('AC3: Legacy header/body detection with sanitized warning', () => {
    it('logs sanitized warning when legacy headers present', async () => {
      await seedFullCatalog();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await GET(
        makeGetRequest({
          'x-api-key': 'sk-super-secret-key-12345',
          'x-provider': 'openai',
          'x-base-url': 'https://evil.example.com',
        }),
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain('legacy-byok');
      expect(msg).toContain('legacy_header:x-api-key');
      expect(msg).toContain('legacy_header:x-provider');
      expect(msg).toContain('legacy_header:x-base-url');
      // Key value must NOT appear in the warning
      expect(msg).not.toContain('sk-super-secret-key-12345');
      warnSpy.mockRestore();
    });

    it('does not log when no legacy headers present', async () => {
      await seedFullCatalog();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await GET(makeGetRequest());

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('catalog response succeeds despite legacy headers — ignore strategy', async () => {
      await seedFullCatalog();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await GET(
        makeGetRequest({ 'x-api-key': 'sk-whatever' }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.models.length).toBeGreaterThan(0);

      warnSpy.mockRestore();
    });
  });

  describe('AC4: Catalog returns only safe public fields', () => {
    it('response includes only allowed fields', async () => {
      await seedFullCatalog();

      const res = await GET(makeGetRequest());
      const body = await res.json();
      const model = body.models[0];

      // Allowed fields
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('modelIdentifier');
      expect(model).toHaveProperty('displayName');
      expect(model).toHaveProperty('capabilities');
      expect(model).toHaveProperty('tier');
      expect(model).toHaveProperty('fixedPrice');
      expect(model).toHaveProperty('tokenPriceInput');
      expect(model).toHaveProperty('tokenPriceOutput');

      // Must NOT include sensitive fields
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('encryptedCredentials');
      expect(bodyStr).not.toContain('credentialVersion');
      expect(bodyStr).not.toContain('baseUrl');
      expect(bodyStr).not.toContain('providerId');
      expect(bodyStr).not.toContain('visibility');
      expect(bodyStr).not.toContain('status');
    });
  });

  describe('AC5: Disabled models excluded and rejected on direct use', () => {
    it('disabled model does not appear in catalog', async () => {
      await seedFullCatalog();

      const res = await GET(makeGetRequest());
      const body = await res.json();
      const ids = body.models.map((m: { id: string }) => m.id);

      // Active public models from active providers should appear
      expect(ids).toContain('model-active-text');
      expect(ids).toContain('model-active-image');
      // Disabled model should NOT appear
      expect(ids).not.toContain('model-disabled');
      // Private model should NOT appear
      expect(ids).not.toContain('model-private');
      // Model from disabled provider should NOT appear
      expect(ids).not.toContain('model-from-disabled-provider');
    });

    it('disabled model ID is rejected by validateModelAccess', async () => {
      await seedFullCatalog();

      const result = await validateModelAccess('model-disabled');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
    });

    it('private model ID is rejected by validateModelAccess', async () => {
      await seedFullCatalog();

      const result = await validateModelAccess('model-private');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
    });

    it('model from disabled provider is rejected by validateModelAccess', async () => {
      await seedFullCatalog();

      const result = await validateModelAccess('model-from-disabled-provider');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
    });

    it('non-existent model ID is rejected by validateModelAccess', async () => {
      await seedFullCatalog();

      const result = await validateModelAccess('does-not-exist');
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
    });

    it('active public model from active provider passes validation', async () => {
      await seedFullCatalog();

      const result = await validateModelAccess('model-active-text');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.model.modelIdentifier).toBe('gpt-4-active');
      }
    });

    it('catalog reflects status change immediately on next request', async () => {
      await seedFullCatalog();

      // Initially model-active-text is in catalog
      const res1 = await GET(makeGetRequest());
      const body1 = await res1.json();
      expect(body1.models.map((m: { id: string }) => m.id)).toContain('model-active-text');

      // Disable the model
      await db
        .update(aiModels)
        .set({ status: 'disabled' })
        .where(sql`${aiModels.id} = 'model-active-text'`);

      // Next catalog request should NOT include it
      const res2 = await GET(makeGetRequest());
      const body2 = await res2.json();
      expect(body2.models.map((m: { id: string }) => m.id)).not.toContain('model-active-text');

      // Direct validation should also reject
      const result = await validateModelAccess('model-active-text');
      expect(result.ok).toBe(false);
    });
  });
});
