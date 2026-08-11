import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-034 tests: Model catalog management and user catalog API
 *
 * Validates:
 * - AC1: Create/edit/disable models with capabilities, limits, tier, pricing
 * - AC2: Validate negative prices, invalid limits, duplicate identifier, non-existent provider
 * - AC3: User catalog returns only enabled + authorized models with public pricing
 * - AC4: Catalog response excludes provider keys or internal URLs
 * - AC5: Disabled/unauthorized model → MODEL_NOT_ALLOWED
 */

// --- Mock the DB module ---
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

// --- Mock guards ---
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

vi.mock('@/lib/auth/helpers', () => ({
  getUserIdFromRequest: vi.fn(() => 'test-fp'),
  resolveUser: vi.fn(),
}));

// --- Imports ---
import { GET as listModels, POST as createModel } from './route';
import { PATCH as updateModel } from './[id]/route';
import { GET as getCatalog } from '@/app/api/ai/models/route';
import { validateModelAccess } from '@/lib/ai/model-catalog';
import { db } from '@/lib/db';
import { users, aiProviders, aiModels } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string, role: 'user' | 'super_admin' = 'user') {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: role });
}
async function seedProvider(id: string, type: string, name: string, status = 'active') {
  await db.insert(aiProviders).values({ id, type, name, status: status as 'active' | 'disabled' });
}
async function seedModel(id: string, providerId: string, identifier: string, name: string, opts: {
  status?: string; visibility?: string; tier?: string; fixedPrice?: number;
} = {}) {
  await db.insert(aiModels).values({
    id, providerId, modelIdentifier: identifier, displayName: name,
    status: (opts.status ?? 'active') as 'active' | 'disabled',
    visibility: opts.visibility ?? 'public',
    tier: opts.tier ?? 'standard',
    fixedPrice: opts.fixedPrice ?? 0,
  });
}

function setAdmin() { ctxState.userId = 'admin1'; ctxState.role = 'super_admin'; }
function setUser() { ctxState.userId = 'user1'; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiModels);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Create/edit models ==========
describe('AC1: Model management', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    await seedProvider('p1', 'openai', 'OpenAI');
    setAdmin();
  });

  it('creates a model with capabilities and pricing', async () => {
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'p1',
          modelIdentifier: 'gpt-4',
          displayName: 'GPT-4',
          capabilities: ['text', 'image_generation'],
          tier: 'premium',
          fixedPrice: 50,
          tokenPriceInput: 10,
          tokenPriceOutput: 30,
          inputTokenLimit: 128000,
          outputTokenLimit: 4096,
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.model.modelIdentifier).toBe('gpt-4');
    expect(body.model.displayName).toBe('GPT-4');
    expect(body.model.fixedPrice).toBe(50);
  });

  it('updates model status to disabled', async () => {
    await seedModel('m1', 'p1', 'gpt-3.5', 'GPT-3.5');
    const res = await updateModel(
      new Request('http://localhost/api/admin/models/m1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'disabled' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'm1' }) },
    );

    expect(res.status).toBe(200);
    const model = await db.select().from(aiModels).where(eq(aiModels.id, 'm1')).limit(1);
    expect(model[0].status).toBe('disabled');
  });

  it('updates pricing and limits', async () => {
    await seedModel('m2', 'p1', 'gpt-4', 'GPT-4');
    const res = await updateModel(
      new Request('http://localhost/api/admin/models/m2', {
        method: 'PATCH',
        body: JSON.stringify({ fixedPrice: 100, tokenPriceInput: 5 }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'm2' }) },
    );

    expect(res.status).toBe(200);
    const model = await db.select().from(aiModels).where(eq(aiModels.id, 'm2')).limit(1);
    expect(model[0].fixedPrice).toBe(100);
    expect(model[0].tokenPriceInput).toBe(5);
  });
});

// ========== AC2: Validation ==========
describe('AC2: Field validation', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    await seedProvider('p1', 'openai', 'OpenAI');
    setAdmin();
  });

  it('rejects non-existent provider', async () => {
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'nonexistent', modelIdentifier: 'test', displayName: 'Test' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PROVIDER_NOT_FOUND');
  });

  it('rejects duplicate model identifier', async () => {
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'p1', modelIdentifier: 'gpt-4', displayName: 'Duplicate' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('MODEL_IDENTIFIER_EXISTS');
  });

  it('rejects negative fixedPrice', async () => {
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'p1', modelIdentifier: 'test', displayName: 'Test', fixedPrice: -1 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects negative tokenPriceInput', async () => {
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'p1', modelIdentifier: 'test', displayName: 'Test', tokenPriceInput: -5 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects negative token limit', async () => {
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'p1', modelIdentifier: 'test', displayName: 'Test', inputTokenLimit: -100 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ========== AC3: User catalog ==========
describe('AC3: User-facing catalog', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedProvider('p2', 'anthropic', 'Anthropic');
    // Active public model
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4', { fixedPrice: 50 });
    // Disabled model (should not appear)
    await seedModel('m2', 'p1', 'gpt-3.5', 'GPT-3.5', { status: 'disabled' });
    // Private model (should not appear)
    await seedModel('m3', 'p2', 'claude-3', 'Claude 3', { visibility: 'private' });
    setUser();
  });

  it('returns only active public models', async () => {
    const res = await getCatalog(new Request('http://localhost/api/ai/models'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].modelIdentifier).toBe('gpt-4');
  });

  it('returns capabilities and pricing info', async () => {
    const res = await getCatalog(new Request('http://localhost/api/ai/models'));
    const body = await res.json();
    expect(body.models[0].fixedPrice).toBe(50);
    expect(body.models[0].capabilities).toBeDefined();
    expect(body.models[0].tier).toBe('standard');
  });

  it('excludes disabled provider models', async () => {
    await seedProvider('p3', 'custom', 'Custom', 'disabled');
    await seedModel('m4', 'p3', 'custom-model', 'Custom Model');

    const res = await getCatalog(new Request('http://localhost/api/ai/models'));
    const body = await res.json();
    // m4 should not appear (provider disabled)
    expect(body.models.find((m: { id: string }) => m.id === 'm4')).toBeUndefined();
  });
});

// ========== AC4: No sensitive data in catalog ==========
describe('AC4: Catalog excludes sensitive data', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
    setUser();
  });

  it('catalog does not contain provider keys or URLs', async () => {
    const res = await getCatalog(new Request('http://localhost/api/ai/models'));
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('encryptedCredentials');
    expect(serialized).not.toContain('baseUrl');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('sk-');
  });
});

// ========== AC5: MODEL_NOT_ALLOWED ==========
describe('AC5: validateModelAccess', () => {
  beforeEach(async () => {
    await seedProvider('p1', 'openai', 'OpenAI');
    await seedModel('m1', 'p1', 'gpt-4', 'GPT-4');
    await seedModel('m2', 'p1', 'gpt-3.5', 'GPT-3.5', { status: 'disabled' });
    await seedModel('m3', 'p1', 'private-model', 'Private', { visibility: 'private' });
  });

  it('allows active public model', async () => {
    const result = await validateModelAccess('m1');
    expect(result.ok).toBe(true);
  });

  it('rejects disabled model', async () => {
    const result = await validateModelAccess('m2');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
  });

  it('rejects private model', async () => {
    const result = await validateModelAccess('m3');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
  });

  it('rejects non-existent model', async () => {
    const result = await validateModelAccess('nonexistent');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('MODEL_NOT_ALLOWED');
  });
});

// ========== Authorization ==========
describe('Authorization', () => {
  beforeEach(async () => {
    await seedUser('normal1', 'normal@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
    setUnauth();
  });

  it('returns 401 for unauthenticated on admin endpoints', async () => {
    const res = await listModels();
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin on create', async () => {
    setUser();
    const res = await createModel(
      new Request('http://localhost/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ providerId: 'p1', modelIdentifier: 'test', displayName: 'Test' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(403);
  });
});
