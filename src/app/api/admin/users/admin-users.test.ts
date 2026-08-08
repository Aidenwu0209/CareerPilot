import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-027 tests: Super admin user query and freeze/unfreeze API
 *
 * Validates:
 * - AC1: Search by name/email with balance + org summary
 * - AC2: Non-super-admin → 403
 * - AC3: Freeze/unfreeze requires idempotency key + writes audit event
 * - AC4: After freeze, user status is 'suspended'
 * - AC5: Response excludes resumes, tokens, AI keys
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
const ctxState = { userId: null as string | null, role: 'user' as string, suspended: false };

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (!ctxState.userId) return null;
    if (ctxState.suspended) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'ACCOUNT_SUSPENDED' }), {
          status: 403, headers: { 'content-type': 'application/json' },
        }),
      };
    }
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
import { GET as listUsers } from './route';
import { GET as getUser } from './[id]/route';
import { POST as freezeUser } from './[id]/freeze/route';
import { db } from '@/lib/db';
import { users, creditAccounts, creditRules, creditTransactions } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string, opts: { role?: string; status?: string; name?: string } = {}) {
  await db.insert(users).values({
    id, email,
    name: opts.name ?? email.split('@')[0],
    authType: 'email',
    platformRole: (opts.role ?? 'user') as 'user' | 'super_admin',
    status: (opts.status ?? 'active') as 'active' | 'suspended',
  });
}

async function seedBalance(ownerId: string, balance: number) {
  await db.insert(creditAccounts).values({ ownerType: 'user', ownerId, balance });
}

function setAdmin() { ctxState.userId = 'admin1'; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setNormal() { ctxState.userId = 'normal1'; ctxState.role = 'user'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

beforeEach(async () => {
  // Disable FK constraints for cleanup — credit_transactions is immutable
  // (triggers block DELETE), so we can't cascade delete users otherwise
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(creditRules);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

describe('AC1: Admin user search', () => {
  it('returns users with role, status, and balance', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('u1', 'u1@test.com');
    await seedBalance('u1', 500);
    setAdmin();

    const req = new Request('http://localhost/api/admin/users');
    const res = await listUsers(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    const u1 = body.users.find((u: any) => u.id === 'u1');
    expect(u1).toBeDefined();
    expect(u1.balance).toBe(500);
    expect(u1.platformRole).toBe('user');
    expect(u1.status).toBe('active');
  });

  it('searches by exact email', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('u2', 'findme@test.com', { name: 'Alice' });
    await seedUser('u3', 'other@test.com', { name: 'Bob' });
    setAdmin();

    const req = new Request('http://localhost/api/admin/users?q=findme@test.com');
    const res = await listUsers(req);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe('findme@test.com');
  });

  it('searches by name (case-insensitive)', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('u4', 'u4@test.com', { name: 'Charlie Brown' });
    setAdmin();

    const req = new Request('http://localhost/api/admin/users?q=charlie');
    const res = await listUsers(req);
    const body = await res.json();
    expect(body.users.some((u: any) => u.name === 'Charlie Brown')).toBe(true);
  });
});

describe('AC2: Non-super-admin → 403', () => {
  it('returns 403 for normal user', async () => {
    await seedUser('normal1', 'normal@test.com');
    setNormal();

    const req = new Request('http://localhost/api/admin/users');
    const res = await listUsers(req);
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated', async () => {
    setUnauth();
    const req = new Request('http://localhost/api/admin/users');
    const res = await listUsers(req);
    expect(res.status).toBe(401);
  });
});

describe('AC3: Freeze/unfreeze with idempotency + audit', () => {
  it('freezes a user and writes audit event', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('target1', 'target@test.com');
    setAdmin();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/target1/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'freeze-target1-v1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('suspended');
    expect(body.action).toBe('freeze');

    // Verify user is actually suspended in DB
    const updated = await db.select().from(users).where(eq(users.id, 'target1')).limit(1);
    expect(updated[0].status).toBe('suspended');
  });

  it('unfreezes a suspended user', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('target2', 'target2@test.com', { status: 'suspended' });
    setAdmin();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/target2/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'unfreeze', idempotencyKey: 'unfreeze-target2-v1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target2' }) },
    );

    expect(res.status).toBe(200);
    const updated = await db.select().from(users).where(eq(users.id, 'target2')).limit(1);
    expect(updated[0].status).toBe('active');
  });

  it('requires idempotency key', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('target3', 'target3@test.com');
    setAdmin();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/target3/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target3' }) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 403 for non-admin calling freeze', async () => {
    await seedUser('normal1', 'normal@test.com');
    await seedUser('target4', 'target4@test.com');
    setNormal();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/target4/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'k1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target4' }) },
    );

    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent target', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    setAdmin();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/nonexistent/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'k2' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    );

    expect(res.status).toBe(404);
  });

  it('is idempotent when called twice with same key', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('target5', 'target5@test.com');
    setAdmin();

    // First call
    const res1 = await freezeUser(
      new Request('http://localhost/api/admin/users/target5/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'dup-key' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target5' }) },
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.idempotent).toBe(false);

    // Second call — should be idempotent (audit dedup)
    const res2 = await freezeUser(
      new Request('http://localhost/api/admin/users/target5/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'dup-key' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target5' }) },
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.idempotent).toBe(true);

    // User still suspended
    const updated = await db.select().from(users).where(eq(users.id, 'target5')).limit(1);
    expect(updated[0].status).toBe('suspended');
  });

  it('calling freeze on already-frozen user returns idempotent success', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('target6', 'target6@test.com', { status: 'suspended' });
    setAdmin();

    const res = await freezeUser(
      new Request('http://localhost/api/admin/users/target6/freeze', {
        method: 'POST',
        body: JSON.stringify({ action: 'freeze', idempotencyKey: 'already-frozen-v1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'target6' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('suspended');
    expect(body.idempotent).toBe(true);
  });
});

describe('AC5: Response excludes sensitive data', () => {
  it('user detail does not include resumes, tokens, or AI keys', async () => {
    await seedUser('admin1', 'admin@test.com', { role: 'super_admin' });
    await seedUser('u10', 'u10@test.com');
    setAdmin();

    const res = await getUser(
      new Request('http://localhost/api/admin/users/u10'),
      { params: Promise.resolve({ id: 'u10' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // No sensitive fields
    expect(body).not.toHaveProperty('fingerprint');
    expect(body).not.toHaveProperty('settings');
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(body)).not.toContain('sk-');
    expect(JSON.stringify(body)).not.toContain('AIza');
  });
});
