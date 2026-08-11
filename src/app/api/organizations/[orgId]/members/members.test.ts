import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-030 tests: Organization member and seat management API
 *
 * Validates:
 * - AC1: Add registered user by exact email
 * - AC2: Duplicate member, seat limit, billing conflict errors
 * - AC3: Org admin can manage own org only, no super_admin grants
 * - AC4: Removal immediately blocks org requests; historical data preserved
 * - AC5: Member response excludes sensitive data
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
import { GET as listMembers, POST as addMember } from './route';
import { DELETE as removeMember } from './[userId]/route';
import { db } from '@/lib/db';
import { users, organizations, organizationMemberships } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string, role: 'user' | 'super_admin' = 'user') {
  await db.insert(users).values({
    id, email, name: email.split('@')[0], authType: 'email', platformRole: role,
  });
}

async function seedOrg(id: string, name: string, slug: string, seatLimit = 10) {
  await db.insert(organizations).values({
    id, name, slug, seatLimit, status: 'active', createdBy: 'admin1',
  });
}

async function seedMembership(orgId: string, userId: string, role: 'org_admin' | 'member' = 'member', status: 'active' | 'removed' = 'active') {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role, status });
}

function setAdmin(adminId: string) { ctxState.userId = adminId; ctxState.role = 'user'; ctxState.suspended = false; }
function setSuperAdmin(adminId: string) { ctxState.userId = adminId; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Add member ==========
describe('AC1: Add member by email', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org', 10);
    await seedMembership('org1', 'admin1', 'org_admin');
    setAdmin('admin1');
  });

  it('adds a registered user as member', async () => {
    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('member');
    expect(body.status).toBe('active');

    // Verify in DB
    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].role).toBe('member');
    expect(membership[0].status).toBe('active');
  });

  it('rejects non-existent user', async () => {
    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'ghost@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ========== AC2: Validation errors ==========
describe('AC2: Duplicate, seat limit, conflicts', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org', 10);
    await seedMembership('org1', 'admin1', 'org_admin');
    setAdmin('admin1');
  });

  it('rejects duplicate active member', async () => {
    await seedMembership('org1', 'user1', 'member');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_MEMBER');
  });

  it('rejects when seat limit exceeded', async () => {
    // Create a separate org with 1 seat, used by admin
    await seedOrg('org-small', 'Small Org', 'small', 1);
    await seedMembership('org-small', 'admin1', 'org_admin');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org-small/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org-small' }) },
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('SEAT_LIMIT_EXCEEDED');

    // Verify no membership was created
    const memberships = await db.select().from(organizationMemberships)
      .where(eq(organizationMemberships.userId, 'user1'));
    expect(memberships).toHaveLength(0);
  });

  it('allows re-adding a previously removed member', async () => {
    await seedMembership('org1', 'user1', 'member', 'removed');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(201);
    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].status).toBe('active');
  });

  it('rejects billing conflict when user is active in another org', async () => {
    await seedOrg('org2', 'Other Org', 'other-org', 10);
    await seedMembership('org2', 'user1', 'member', 'active');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('BILLING_CONFLICT');

    // Verify no membership created in org1
    const m = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')));
    expect(m).toHaveLength(0);
  });
});

// ========== AC3: Authorization ==========
describe('AC3: Org admin authorization', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('admin2', 'admin2@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Org One', 'org-one', 10);
    await seedOrg('org2', 'Org Two', 'org-two', 10);
  });

  it('rejects non-admin user', async () => {
    await seedMembership('org1', 'user1', 'member');
    setAdmin('user1');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(403);
  });

  it('rejects org admin of different org', async () => {
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org2', 'admin2', 'org_admin');
    setAdmin('admin1');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org2/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org2' }) },
    );

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated', async () => {
    setUnauth();

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(401);
  });

  it('super admin can add members to any org', async () => {
    await seedUser('super1', 'super@test.com', 'super_admin');
    setSuperAdmin('super1');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(201);
  });

  it('rejects adding super_admin as member', async () => {
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedMembership('org1', 'admin1', 'org_admin');
    setAdmin('admin1');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org1/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'super@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('CANNOT_ADD_SUPER_ADMIN');
  });

  it('rejects managing members of suspended org', async () => {
    await db.insert(organizations).values({
      id: 'org3', name: 'Suspended Org', slug: 'suspended', seatLimit: 10, status: 'suspended', createdBy: 'admin1',
    });
    await seedMembership('org3', 'admin1', 'org_admin');
    setAdmin('admin1');

    const res = await addMember(
      new Request('http://localhost/api/organizations/org3/members', {
        method: 'POST',
        body: JSON.stringify({ email: 'user1@test.com' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org3' }) },
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ORG_SUSPENDED');
  });
});

// ========== AC4: Remove member ==========
describe('AC4: Remove member', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org', 10);
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org1', 'user1', 'member');
    setAdmin('admin1');
  });

  it('removes a member', async () => {
    const res = await removeMember(
      new Request('http://localhost/api/organizations/org1/members/user1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'user1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('removed');

    // Verify in DB — status is 'removed', not deleted
    const membership = await db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, 'org1'), eq(organizationMemberships.userId, 'user1')))
      .limit(1);
    expect(membership[0].status).toBe('removed');
  });

  it('preserves historical data after removal', async () => {
    await removeMember(
      new Request('http://localhost/api/organizations/org1/members/user1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'user1' }) },
    );

    // Membership row still exists with 'removed' status
    const memberships = await db.select().from(organizationMemberships)
      .where(eq(organizationMemberships.userId, 'user1'));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].status).toBe('removed');
  });

  it('rejects removing non-existent membership', async () => {
    const res = await removeMember(
      new Request('http://localhost/api/organizations/org1/members/nonexistent', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'nonexistent' }) },
    );
    expect(res.status).toBe(404);
  });

  it('rejects removing already-removed member', async () => {
    // First remove
    await removeMember(
      new Request('http://localhost/api/organizations/org1/members/user1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'user1' }) },
    );

    // Second remove
    const res = await removeMember(
      new Request('http://localhost/api/organizations/org1/members/user1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'user1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('org admin cannot remove another org admin', async () => {
    await seedUser('admin2', 'admin2@test.com');
    await seedMembership('org1', 'admin2', 'org_admin');

    const res = await removeMember(
      new Request('http://localhost/api/organizations/org1/members/admin2', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ orgId: 'org1', userId: 'admin2' }) },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('CANNOT_REMOVE_ADMIN');
  });
});

// ========== AC5: Response excludes sensitive data ==========
describe('AC5: Member response excludes sensitive data', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org', 10);
    await seedMembership('org1', 'admin1', 'org_admin');
    setAdmin('admin1');
  });

  it('member list does not include sensitive fields', async () => {
    await seedMembership('org1', 'user1', 'member');

    const res = await listMembers(
      new Request('http://localhost/api/organizations/org1/members'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(2); // admin + user1

    const member = body.members.find((m: { userId: string }) => m.userId === 'user1');
    expect(member).toBeDefined();
    expect(member.email).toBe('user1@test.com');
    expect(member.name).toBe('user1');
    // No sensitive data
    expect(member).not.toHaveProperty('fingerprint');
    expect(member).not.toHaveProperty('settings');
    expect(member).not.toHaveProperty('accessToken');
    expect(member).not.toHaveProperty('apiKey');
    expect(JSON.stringify(body)).not.toContain('sk-');
    expect(JSON.stringify(body)).not.toContain('AIza');
  });

  it('returns seat usage info', async () => {
    await seedMembership('org1', 'user1', 'member');

    const res = await listMembers(
      new Request('http://localhost/api/organizations/org1/members'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    const body = await res.json();
    expect(body.seats).toBeDefined();
    expect(body.seats.used).toBe(2); // admin + user1
    expect(body.seats.limit).toBe(10);
  });
});
