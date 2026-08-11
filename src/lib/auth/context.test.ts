import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-015 tests: Unified Actor, Tenant & Billing Context Resolution
 *
 * Validates:
 * AC1: Actor resolved from session, platformRole/status loaded from DB
 * AC2: Org context only from valid membership (client values not trusted)
 * AC3: No org → personal; single org → org account
 * AC4: Multiple active orgs → explicit error (no silent selection)
 * AC5: Context object contains no provider keys/credentials
 */

// --- Mock helpers to avoid pulling in next-auth/next server ---
vi.mock('./helpers', () => ({
  resolveUser: vi.fn(),
}));

// --- Mock the DB module with an in-memory SQLite instance ---
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

// --- Mock sample-resume ---
vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Import AFTER mocks ---
import { resolveContextForUser, AmbiguousBillingError } from './context';
import { db } from '@/lib/db';
import {
  users,
  organizations,
  organizationMemberships,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ── Helpers ──

async function createUser(opts: {
  email?: string;
  platformRole?: 'super_admin' | 'user';
  status?: 'active' | 'suspended';
  authType?: 'oauth' | 'fingerprint' | 'email';
}) {
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: opts.email ?? `user-${id}@test.com`,
    name: 'Test User',
    authType: opts.authType ?? 'email',
    platformRole: opts.platformRole ?? 'user',
    status: opts.status ?? 'active',
  });
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

async function createOrg(opts: {
  slug: string;
  name?: string;
  status?: 'active' | 'suspended';
  createdBy: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(organizations).values({
    id,
    slug: opts.slug,
    name: opts.name ?? `Org ${opts.slug}`,
    status: opts.status ?? 'active',
    seatLimit: 10,
    createdBy: opts.createdBy,
  });
  const result = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return result[0];
}

async function createMembership(opts: {
  userId: string;
  organizationId: string;
  role?: 'org_admin' | 'member';
  status?: 'active' | 'removed';
}) {
  const id = crypto.randomUUID();
  await db.insert(organizationMemberships).values({
    id,
    userId: opts.userId,
    organizationId: opts.organizationId,
    role: opts.role ?? 'member',
    status: opts.status ?? 'active',
  });
  const result = await db
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.id, id))
    .limit(1);
  return result[0];
}

// ── Cleanup ──

beforeEach(async () => {
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
});

// ── Tests ──

describe('US-015: Unified Actor, Tenant & Billing Context Resolution', () => {
  describe('AC1: Actor resolved from session with DB-loaded platformRole and status', () => {
    it('resolves actor with default role (user) and status (active)', async () => {
      const user = await createUser({ email: 'default@test.com' });
      const ctx = await resolveContextForUser(user);

      expect(ctx.actor).toEqual({
        userId: user.id,
        platformRole: 'user',
        status: 'active',
      });
    });

    it('loads super_admin role from DB', async () => {
      const user = await createUser({
        email: 'admin@test.com',
        platformRole: 'super_admin',
      });
      const ctx = await resolveContextForUser(user);

      expect(ctx.actor.platformRole).toBe('super_admin');
    });

    it('loads suspended status from DB', async () => {
      const user = await createUser({
        email: 'suspended@test.com',
        status: 'suspended',
      });
      const ctx = await resolveContextForUser(user);

      expect(ctx.actor.status).toBe('suspended');
    });

    it('reflects DB changes if user role changes after initial creation', async () => {
      const user = await createUser({ email: 'promote@test.com' });
      let ctx = await resolveContextForUser(user);
      expect(ctx.actor.platformRole).toBe('user');

      // Promote in DB
      await db
        .update(users)
        .set({ platformRole: 'super_admin' })
        .where(eq(users.id, user.id));

      // Re-fetch the user to get updated platformRole
      const updated = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      ctx = await resolveContextForUser(updated[0]);
      expect(ctx.actor.platformRole).toBe('super_admin');
    });
  });

  describe('AC2: Org context only from valid membership', () => {
    it('resolves org context from DB membership, not from any client input', async () => {
      const user = await createUser({ email: 'member@test.com' });
      const org = await createOrg({ slug: 'acme', createdBy: user.id });
      await createMembership({
        userId: user.id,
        organizationId: org.id,
        role: 'member',
      });

      // resolveContextForUser takes ONLY a user object — there is no way
      // to pass organizationId or role from the client
      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.type).toBe('organization');
      expect(ctx.tenant.organizationId).toBe(org.id);
      expect(ctx.tenant.orgRole).toBe('member');
    });

    it('does not expose a way to inject client-supplied userId or orgId', async () => {
      // The function signature only accepts a user object from the server.
      // There is no organizationId or role parameter to abuse.
      const user = await createUser({ email: 'safe@test.com' });
      const ctx = await resolveContextForUser(user);

      // Personal context since no membership exists
      expect(ctx.tenant.type).toBe('personal');
      expect(ctx.tenant.organizationId).toBeNull();
    });

    it('ignores removed memberships', async () => {
      const user = await createUser({ email: 'removed@test.com' });
      const org = await createOrg({ slug: 'removed-org', createdBy: user.id });
      await createMembership({
        userId: user.id,
        organizationId: org.id,
        status: 'removed',
      });

      const ctx = await resolveContextForUser(user);

      // Removed membership → treated as no org → personal
      expect(ctx.tenant.type).toBe('personal');
      expect(ctx.tenant.organizationId).toBeNull();
    });

    it('ignores memberships in suspended organizations', async () => {
      const user = await createUser({ email: 'suspended-org@test.com' });
      const org = await createOrg({
        slug: 'suspended',
        status: 'suspended',
        createdBy: user.id,
      });
      await createMembership({
        userId: user.id,
        organizationId: org.id,
        status: 'active',
      });

      const ctx = await resolveContextForUser(user);

      // Active membership but org is suspended → not counted
      expect(ctx.tenant.type).toBe('personal');
      expect(ctx.tenant.organizationId).toBeNull();
    });
  });

  describe('AC3: No org → personal; single org → org account', () => {
    it('user with no memberships resolves to personal billing', async () => {
      const user = await createUser({ email: 'solo@test.com' });
      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.type).toBe('personal');
      expect(ctx.tenant.organizationId).toBeNull();
      expect(ctx.tenant.orgRole).toBeNull();
      expect(ctx.billing.accountOwnerType).toBe('user');
      expect(ctx.billing.accountOwnerId).toBe(user.id);
    });

    it('user with one active membership resolves to org billing', async () => {
      const user = await createUser({ email: 'orguser@test.com' });
      const org = await createOrg({ slug: 'single-org', createdBy: user.id });
      await createMembership({
        userId: user.id,
        organizationId: org.id,
        role: 'member',
      });

      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.type).toBe('organization');
      expect(ctx.tenant.organizationId).toBe(org.id);
      expect(ctx.tenant.orgRole).toBe('member');
      expect(ctx.billing.accountOwnerType).toBe('organization');
      expect(ctx.billing.accountOwnerId).toBe(org.id);
    });

    it('org_admin role is preserved in the tenant context', async () => {
      const user = await createUser({ email: 'admin@test.com' });
      const org = await createOrg({ slug: 'admin-org', createdBy: user.id });
      await createMembership({
        userId: user.id,
        organizationId: org.id,
        role: 'org_admin',
      });

      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.orgRole).toBe('org_admin');
    });

    it('user with multiple memberships but only one active resolves to that org', async () => {
      const user = await createUser({ email: 'multi@test.com' });
      const org1 = await createOrg({ slug: 'org1', createdBy: user.id });
      const org2 = await createOrg({ slug: 'org2', createdBy: user.id });
      await createMembership({
        userId: user.id,
        organizationId: org1.id,
        status: 'removed',
      });
      await createMembership({
        userId: user.id,
        organizationId: org2.id,
        status: 'active',
      });

      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.type).toBe('organization');
      expect(ctx.tenant.organizationId).toBe(org2.id);
    });
  });

  describe('AC4: Multiple active orgs → explicit error', () => {
    it('throws AmbiguousBillingError for two active org memberships', async () => {
      const user = await createUser({ email: 'ambig@test.com' });
      const org1 = await createOrg({ slug: 'ambig1', createdBy: user.id });
      const org2 = await createOrg({ slug: 'ambig2', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org1.id });
      await createMembership({ userId: user.id, organizationId: org2.id });

      await expect(resolveContextForUser(user)).rejects.toThrow(AmbiguousBillingError);
    });

    it('error includes the organization IDs for client-side handling', async () => {
      const user = await createUser({ email: 'ambig2@test.com' });
      const org1 = await createOrg({ slug: 'ambig3', createdBy: user.id });
      const org2 = await createOrg({ slug: 'ambig4', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org1.id });
      await createMembership({ userId: user.id, organizationId: org2.id });

      try {
        await resolveContextForUser(user);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AmbiguousBillingError);
        const err = e as AmbiguousBillingError;
        expect(err.organizationIds).toHaveLength(2);
        expect(err.organizationIds).toContain(org1.id);
        expect(err.organizationIds).toContain(org2.id);
      }
    });

    it('does NOT silently select the first membership', async () => {
      const user = await createUser({ email: 'nosilent@test.com' });
      const org1 = await createOrg({ slug: 'first', createdBy: user.id });
      const org2 = await createOrg({ slug: 'second', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org1.id });
      await createMembership({ userId: user.id, organizationId: org2.id });

      try {
        await resolveContextForUser(user);
        expect.fail('Should have thrown, not silently selected first org');
      } catch (e) {
        expect(e).toBeInstanceOf(AmbiguousBillingError);
      }
    });

    it('three+ active orgs also throw', async () => {
      const user = await createUser({ email: 'triple@test.com' });
      const org1 = await createOrg({ slug: 't1', createdBy: user.id });
      const org2 = await createOrg({ slug: 't2', createdBy: user.id });
      const org3 = await createOrg({ slug: 't3', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org1.id });
      await createMembership({ userId: user.id, organizationId: org2.id });
      await createMembership({ userId: user.id, organizationId: org3.id });

      await expect(resolveContextForUser(user)).rejects.toThrow(AmbiguousBillingError);
    });
  });

  describe('AC5: Context object contains no provider keys or secrets', () => {
    it('context keys are strictly actor/tenant/billing — no credential fields', async () => {
      const user = await createUser({ email: 'safe@test.com' });
      const ctx = await resolveContextForUser(user);

      const topLevelKeys = Object.keys(ctx);
      expect(topLevelKeys).toEqual(['actor', 'tenant', 'billing']);
      expect(topLevelKeys).not.toContain('credentials');
      expect(topLevelKeys).not.toContain('apiKey');
      expect(topLevelKeys).not.toContain('secret');
      expect(topLevelKeys).not.toContain('token');
      expect(topLevelKeys).not.toContain('encryptedCredentials');
    });

    it('actor object has no sensitive fields', async () => {
      const user = await createUser({ email: 'safe2@test.com' });
      const ctx = await resolveContextForUser(user);

      const actorKeys = Object.keys(ctx.actor);
      expect(actorKeys).toEqual(['userId', 'platformRole', 'status']);
      expect(actorKeys).not.toContain('password');
      expect(actorKeys).not.toContain('settings');
      expect(actorKeys).not.toContain('fingerprint');
      expect(actorKeys).not.toContain('email');
    });

    it('tenant object has no sensitive fields', async () => {
      const user = await createUser({ email: 'safe3@test.com' });
      const org = await createOrg({ slug: 'safe-org', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org.id });

      const ctx = await resolveContextForUser(user);

      const tenantKeys = Object.keys(ctx.tenant);
      expect(tenantKeys).toEqual(['type', 'organizationId', 'orgRole']);
      expect(tenantKeys).not.toContain('slug');
      expect(tenantKeys).not.toContain('name');
      expect(tenantKeys).not.toContain('seatLimit');
    });

    it('billing object has no sensitive fields', async () => {
      const user = await createUser({ email: 'safe4@test.com' });
      const ctx = await resolveContextForUser(user);

      const billingKeys = Object.keys(ctx.billing);
      expect(billingKeys).toEqual(['accountOwnerType', 'accountOwnerId']);
      expect(billingKeys).not.toContain('balance');
      expect(billingKeys).not.toContain('status');
      expect(billingKeys).not.toContain('credentials');
    });

    it('context is safe to serialize to client (no secrets anywhere in tree)', async () => {
      const user = await createUser({ email: 'serialize@test.com' });
      const ctx = await resolveContextForUser(user);
      const serialized = JSON.stringify(ctx);

      // No secret-like values should appear in the serialized form
      expect(serialized).not.toMatch(/password|secret|apiKey|credential|token|encrypted/i);
    });
  });

  describe('Edge cases', () => {
    it('super_admin with no org memberships resolves to personal billing', async () => {
      const user = await createUser({
        email: 'root@test.com',
        platformRole: 'super_admin',
      });
      const ctx = await resolveContextForUser(user);

      expect(ctx.actor.platformRole).toBe('super_admin');
      expect(ctx.tenant.type).toBe('personal');
      expect(ctx.billing.accountOwnerType).toBe('user');
    });

    it('super_admin with one org membership resolves to org billing', async () => {
      const user = await createUser({
        email: 'root-org@test.com',
        platformRole: 'super_admin',
      });
      const org = await createOrg({ slug: 'root-org', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org.id });

      const ctx = await resolveContextForUser(user);

      expect(ctx.tenant.type).toBe('organization');
      expect(ctx.billing.accountOwnerType).toBe('organization');
    });

    it('suspended user with org membership still resolves (enforcement is US-017)', async () => {
      const user = await createUser({
        email: 'suspended-member@test.com',
        status: 'suspended',
      });
      const org = await createOrg({ slug: 'suspended-member-org', createdBy: user.id });
      await createMembership({ userId: user.id, organizationId: org.id });

      const ctx = await resolveContextForUser(user);

      expect(ctx.actor.status).toBe('suspended');
      expect(ctx.tenant.type).toBe('organization');
    });

    it('membership in a different org (other user) does not affect resolution', async () => {
      const user1 = await createUser({ email: 'user1@test.com' });
      const user2 = await createUser({ email: 'user2@test.com' });
      const org = await createOrg({ slug: 'cross-user', createdBy: user1.id });
      await createMembership({ userId: user2.id, organizationId: org.id });

      // user1 created the org but has no membership → personal
      const ctx = await resolveContextForUser(user1);
      expect(ctx.tenant.type).toBe('personal');
    });
  });
});
