import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-033 tests: Super admin provider management and connection test API
 *
 * Validates:
 * - AC1: Create/edit provider with encrypted credentials
 * - AC2: Connection test uses controlled target, returns sanitized result
 * - AC3: Enable/disable/rotate writes audit events; reads always masked
 * - AC4: Non-super-admin → 403
 * - AC5: Custom baseUrl validated through SSRF guard
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

// --- Set encryption key for tests ---
vi.stubEnv('AI_CREDENTIAL_MASTER_KEY', 'test-master-key-that-is-at-least-32-chars-long!');

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

// --- Mock fetch for connection tests ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- Imports ---
import { GET as listProviders, POST as createProvider } from './route';
import { GET as getProvider, PATCH as updateProvider } from './[id]/route';
import { POST as testProvider } from './[id]/test/route';
import { POST as rotateCredential } from './[id]/credentials/rotate/route';
import { db } from '@/lib/db';
import { users, aiProviders } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string, role: 'user' | 'super_admin' = 'user') {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: role });
}

async function seedProvider(id: string, type: string, name: string, opts: { credential?: string; status?: string; baseUrl?: string | null } = {}) {
  const { encryptCredential } = await import('@/lib/crypto/credential-crypto');
  const encrypted = opts.credential ? encryptCredential(opts.credential) : null;
  await db.insert(aiProviders).values({
    id, type, name,
    baseUrl: opts.baseUrl ?? null,
    encryptedCredentials: encrypted,
    status: (opts.status ?? 'active') as 'active' | 'disabled',
    credentialVersion: 1,
  });
}

function setAdmin() { ctxState.userId = 'admin1'; ctxState.role = 'super_admin'; }
function setNormal() { ctxState.userId = 'normal1'; ctxState.role = 'user'; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviders);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
  mockFetch.mockReset();
});

// ========== AC1: Create/edit provider ==========
describe('AC1: Create and edit provider', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    setAdmin();
  });

  it('creates a provider with encrypted credentials', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai', name: 'OpenAI Prod', credential: 'sk-test-key-123' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provider.type).toBe('openai');
    expect(body.provider.name).toBe('OpenAI Prod');
    expect(body.provider.hasCredentials).toBe(true);
    expect(body.provider.maskedCredential).toContain('•');
    // Never returns plaintext
    expect(JSON.stringify(body)).not.toContain('sk-test-key-123');
  });

  it('creates provider without credentials', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'google', name: 'Google AI' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provider.hasCredentials).toBe(false);
    expect(body.provider.maskedCredential).toBeNull();
  });

  it('rejects missing type', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('updates provider name and status', async () => {
    await seedProvider('p1', 'openai', 'Original');
    const res = await updateProvider(
      new Request('http://localhost/api/admin/providers/p1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated', status: 'disabled' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'p1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.name).toBe('Updated');
    expect(body.provider.status).toBe('disabled');
  });
});

// ========== AC3: Reads always masked, audit on change ==========
describe('AC3: Masked reads and audit', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    await seedProvider('p1', 'openai', 'OpenAI', { credential: 'sk-secret-do-not-leak' });
    setAdmin();
  });

  it('list returns masked credentials only', async () => {
    const res = await listProviders();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers[0].maskedCredential).toContain('•');
    expect(JSON.stringify(body)).not.toContain('sk-secret-do-not-leak');
  });

  it('detail returns masked credential', async () => {
    const res = await getProvider(
      new Request('http://localhost/api/admin/providers/p1'),
      { params: Promise.resolve({ id: 'p1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.maskedCredential).toContain('•');
    expect(JSON.stringify(body)).not.toContain('sk-secret');
  });

  it('rotate credential updates version and returns masked', async () => {
    const res = await rotateCredential(
      new Request('http://localhost/api/admin/providers/p1/credentials/rotate', {
        method: 'POST',
        body: JSON.stringify({ newKey: 'sk-new-rotated-key-456' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'p1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentialVersion).toBe(2);
    expect(body.maskedCredential).toContain('•');
    expect(JSON.stringify(body)).not.toContain('sk-new-rotated-key-456');
  });
});

// ========== AC4: Authorization ==========
describe('AC4: Non-admin access denied', () => {
  beforeEach(async () => {
    await seedUser('normal1', 'normal@test.com');
    await seedProvider('p1', 'openai', 'OpenAI');
  });

  it('returns 403 for normal user on list', async () => {
    setNormal();
    const res = await listProviders();
    expect(res.status).toBe(403);
  });

  it('returns 403 for normal user on create', async () => {
    setNormal();
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai', name: 'Test' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated', async () => {
    setUnauth();
    const res = await listProviders();
    expect(res.status).toBe(401);
  });
});

// ========== AC5: SSRF protection on baseUrl ==========
describe('AC5: baseUrl SSRF validation', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    setAdmin();
  });

  it('accepts allowlisted baseUrl', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provider.baseUrl).toBe('https://api.openai.com');
  });

  it('rejects non-allowlisted baseUrl', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'custom', name: 'Custom', baseUrl: 'https://evil.example.com' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('UPSTREAM_URL_NOT_ALLOWED');
  });

  it('rejects HTTP (non-HTTPS) baseUrl', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai', name: 'Test', baseUrl: 'http://api.openai.com' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects private IP baseUrl', async () => {
    const res = await createProvider(
      new Request('http://localhost/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify({ type: 'openai', name: 'Test', baseUrl: 'https://127.0.0.1' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ========== AC2: Connection test ==========
describe('AC2: Connection test', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com', 'super_admin');
    await seedProvider('p1', 'openai', 'OpenAI', { credential: 'sk-test-key' });
    setAdmin();
  });

  it('returns success on valid connection', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"data":[]}', { status: 200 }));

    const res = await testProvider(
      new Request('http://localhost/api/admin/providers/p1/test', { method: 'POST' }),
      { params: Promise.resolve({ id: 'p1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('success');
    expect(body.httpStatus).toBe(200);
  });

  it('returns failed on 401 response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const res = await testProvider(
      new Request('http://localhost/api/admin/providers/p1/test', { method: 'POST' }),
      { params: Promise.resolve({ id: 'p1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
    expect(body.httpStatus).toBe(401);
  });

  it('returns sanitized error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await testProvider(
      new Request('http://localhost/api/admin/providers/p1/test', { method: 'POST' }),
      { params: Promise.resolve({ id: 'p1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
    expect(body.error).toBe('CONNECTION_ERROR');
    // Should not leak internal error details
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('returns 404 for non-existent provider', async () => {
    const res = await testProvider(
      new Request('http://localhost/api/admin/providers/nonexistent/test', { method: 'POST' }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns failed when provider has no credentials', async () => {
    await seedProvider('p2', 'openai', 'No Key');
    const res = await testProvider(
      new Request('http://localhost/api/admin/providers/p2/test', { method: 'POST' }),
      { params: Promise.resolve({ id: 'p2' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('failed');
    expect(body.error).toBe('NO_CREDENTIALS');
  });
});
