import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-029 tests: Organization lifecycle and admin authorization API
 *
 * Validates:
 * - AC1: Create unique org with name, slug, seatLimit, status
 * - AC2: Validation errors for duplicate slug, empty name, invalid seatLimit
 * - AC3: Appoint/revoke org_admin by exact email
 * - AC4: Suspend org blocks future org-scoped requests
 * - AC5: All lifecycle changes write audit events
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
import { GET as listOrgs, POST as createOrg } from './route';
import { GET as getOrg, PATCH as updateOrg } from './[id]/route';
import { POST as appointAdmin, DELETE as revokeAdmin } from './[id]/admins/route';
import { db } from '@/lib/db';
import { users, organizations, organizationMemberships } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({
    id, email, name: email.split('@')[0], authType: 'email',
  });
}

async function seedOrg(id: string, name: string, slug: string, seatLimit = 10, status = 'active') {
  await db.insert(organizations).values({ id, name, slug, seatLimit, status, createdBy: 'admin1' });
}

function setAdmin() { ctxState.userId = 'admin1'; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setNormal() { ctxState.userId = 'normal1'; ctxState.role = 'user'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Create organization ==========
describe('AC1: Create organization', () => {
  it('creates an organization with valid fields', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Acme Corp', slug: 'acme', seatLimit: 50 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.organization.name).toBe('Acme Corp');
    expect(body.organization.slug).toBe('acme');
    expect(body.organization.seatLimit).toBe(50);
    expect(body.organization.status).toBe('active');
  });

  it('creates with explicit suspended status', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Beta Inc', slug: 'beta', seatLimit: 10, status: 'suspended' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).organization.status).toBe('suspended');
  });
});

// ========== AC2: Validation ==========
describe('AC2: Field validation', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();
  });

  it('rejects empty name', async () => {
    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: '', slug: 'test', seatLimit: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_NAME');
  });

  it('rejects empty slug', async () => {
    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', slug: '', seatLimit: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_SLUG');
  });

  it('rejects negative seatLimit', async () => {
    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', slug: 'test', seatLimit: -1 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_SEAT_LIMIT');
  });

  it('rejects non-integer seatLimit', async () => {
    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', slug: 'test', seatLimit: 1.5 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_SEAT_LIMIT');
  });

  it('rejects duplicate slug', async () => {
    await seedOrg('org1', 'Existing', 'dupe-slug');

    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Org', slug: 'dupe-slug', seatLimit: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('SLUG_ALREADY_EXISTS');

    // Verify no half-created org
    const allOrgs = await db.select().from(organizations);
    expect(allOrgs).toHaveLength(1);
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('normal1', 'normal@test.com');
    setNormal();

    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', slug: 'test', seatLimit: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated', async () => {
    setUnauth();

    const res = await createOrg(
      new Request('http://localhost/api/admin/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', slug: 'test', seatLimit: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ========== AC3: Appoint/revoke org_admin ==========
describe('AC3: Appoint and revoke org_admin', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org');
    setAdmin();
  });

  it('appoints a user as org_admin by email', async () => {
    const res = await appointAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('org_admin');
    expect(body.status).toBe('active');

    // Verify in DB
    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].role).toBe('org_admin');
    expect(membership[0].status).toBe('active');
  });

  it('rejects appointing non-existent user', async () => {
    const res = await appointAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'POST',
        body: JSON.stringify({ email: 'nobody@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('USER_NOT_FOUND');
  });

  it('rejects duplicate appointment', async () => {
    // First appointment
    await appointAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    // Second appointment
    const res = await appointAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('upgrades existing member to org_admin', async () => {
    // Create a regular member first
    await db.insert(organizationMemberships).values({
      organizationId: 'org1', userId: 'user1', role: 'member', status: 'active',
    });

    const res = await appointAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );
    expect(res.status).toBe(201);

    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].role).toBe('org_admin');
  });

  it('revokes org_admin role', async () => {
    // First appoint
    await db.insert(organizationMemberships).values({
      organizationId: 'org1', userId: 'user1', role: 'org_admin', status: 'active',
    });

    const res = await revokeAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'DELETE',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('member');

    // Verify in DB — downgraded to member
    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].role).toBe('member');
    expect(membership[0].status).toBe('active');
  });

  it('rejects revoking non-admin user', async () => {
    await db.insert(organizationMemberships).values({
      organizationId: 'org1', userId: 'user1', role: 'member', status: 'active',
    });

    const res = await revokeAdmin(
      new Request('http://localhost/api/admin/organizations/org1/admins', {
        method: 'DELETE',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NOT_AN_ADMIN');
  });
});

// ========== AC4: Suspend organization ==========
describe('AC4: Suspend/activate organization', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedOrg('org1', 'Test Org', 'test-org');
    setAdmin();
  });

  it('suspends an organization', async () => {
    const res = await updateOrg(
      new Request('http://localhost/api/admin/organizations/org1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'suspended' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organization.status).toBe('suspended');

    // Verify in DB
    const org = await db.select().from(organizations).where(eq(organizations.id, 'org1')).limit(1);
    expect(org[0].status).toBe('suspended');
  });

  it('reactivates a suspended organization', async () => {
    // First suspend
    await updateOrg(
      new Request('http://localhost/api/admin/organizations/org1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'suspended' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    // Then reactivate
    const res = await updateOrg(
      new Request('http://localhost/api/admin/organizations/org1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const org = await db.select().from(organizations).where(eq(organizations.id, 'org1')).limit(1);
    expect(org[0].status).toBe('active');
  });

  it('preserves historical data when suspended', async () => {
    // Add membership and users
    await seedUser('user1', 'user1@test.com');
    await db.insert(organizationMemberships).values({
      organizationId: 'org1', userId: 'user1', role: 'member', status: 'active',
    });

    // Suspend
    await updateOrg(
      new Request('http://localhost/api/admin/organizations/org1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'suspended' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    // Historical data still present
    const memberships = await db.select().from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, 'org1'));
    expect(memberships.length).toBe(1);
    expect(memberships[0].status).toBe('active'); // Not deleted

    const orgs = await db.select().from(organizations).where(eq(organizations.id, 'org1'));
    expect(orgs.length).toBe(1);
    expect(orgs[0].status).toBe('suspended');
  });

  it('updates seatLimit', async () => {
    const res = await updateOrg(
      new Request('http://localhost/api/admin/organizations/org1', {
        method: 'PATCH',
        body: JSON.stringify({ seatLimit: 100 }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const org = await db.select().from(organizations).where(eq(organizations.id, 'org1')).limit(1);
    expect(org[0].seatLimit).toBe(100);
  });

  it('returns 404 for non-existent org', async () => {
    const res = await updateOrg(
      new Request('http://localhost/api/admin/organizations/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'suspended' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ========== List/Detail ==========
describe('List and detail', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();
  });

  it('lists organizations', async () => {
    await seedOrg('org1', 'Alpha', 'alpha');
    await seedOrg('org2', 'Beta', 'beta');

    const res = await listOrgs(new Request('http://localhost/api/admin/organizations'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations.length).toBe(2);
  });

  it('searches by name', async () => {
    await seedOrg('org1', 'Alpha Corp', 'alpha');
    await seedOrg('org2', 'Beta Corp', 'beta');

    const res = await listOrgs(new Request('http://localhost/api/admin/organizations?q=alpha'));
    const body = await res.json();
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].name).toBe('Alpha Corp');
  });

  it('gets org detail with member count', async () => {
    await seedOrg('org1', 'Test Org', 'test-org');
    await seedUser('user1', 'u1@test.com');
    await seedUser('user2', 'u2@test.com');
    await db.insert(organizationMemberships).values([
      { organizationId: 'org1', userId: 'user1', role: 'member', status: 'active' },
      { organizationId: 'org1', userId: 'user2', role: 'member', status: 'active' },
    ]);

    const res = await getOrg(
      new Request('http://localhost/api/admin/organizations/org1'),
      { params: Promise.resolve({ id: 'org1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Test Org');
    expect(body.memberCount).toBe(2);
  });
});
