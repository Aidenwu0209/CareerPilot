import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-031 tests: Organization credit adjustment and balance API
 *
 * Validates:
 * - AC1: Super admin can add/debit org credits with reason + idempotency key
 * - AC2: Cannot go negative; no changes on failure
 * - AC3: Org admin can read balance + transactions, not adjust
 * - AC4: Regular user sees limited balance summary
 * - AC5: Cross-org accountId requests rejected without leakage
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
import { GET as getBalance } from './balance/route';
import { GET as getTransactions } from './transactions/route';
import { POST as adjustOrgCredits } from '@/app/api/admin/organizations/[orgId]/adjust/route';
import { db } from '@/lib/db';
import { users, organizations, organizationMemberships, creditAccounts, creditTransactions } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

async function seedUser(id: string, email: string, role: 'user' | 'super_admin' = 'user') {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: role });
}
async function seedOrg(id: string, name: string, slug: string, createdBy = 'admin1') {
  await db.insert(organizations).values({ id, name, slug, seatLimit: 10, status: 'active', createdBy });
}
async function seedMembership(orgId: string, userId: string, role: 'org_admin' | 'member' = 'member') {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role, status: 'active' });
}
async function seedOrgBalance(orgId: string, balance: number) {
  await db.insert(creditAccounts).values({ ownerType: 'organization', ownerId: orgId, balance });
}

function setSuperAdmin(id: string) { ctxState.userId = id; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Super admin adjust ==========
describe('AC1: Super admin credit adjustment', () => {
  beforeEach(async () => {
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedUser('admin1', 'admin@test.com');
    await seedOrg('org1', 'Test Org', 'test-org');
    await seedOrgBalance('org1', 1000);
    setSuperAdmin('super1');
  });

  it('credits org balance', async () => {
    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 500, reason: 'quarterly allocation', idempotencyKey: 'org-credit-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(1500);
    expect(body.transaction.delta).toBe(500);
  });

  it('debits org balance', async () => {
    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: -200, reason: 'correction', idempotencyKey: 'org-debit-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBe(800);
  });

  it('rejects missing reason', async () => {
    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, idempotencyKey: 'k1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing idempotency key', async () => {
    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-super-admin', async () => {
    await seedMembership('org1', 'admin1', 'org_admin');
    setUser('admin1');

    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test', idempotencyKey: 'k2' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ========== AC2: Cannot go negative ==========
describe('AC2: Insufficient credits protection', () => {
  beforeEach(async () => {
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedOrg('org1', 'Test Org', 'test-org', 'super1');
    await seedOrgBalance('org1', 100);
    setSuperAdmin('super1');
  });

  it('rejects debit exceeding balance', async () => {
    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: -500, reason: 'overdraft', idempotencyKey: 'over-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('INSUFFICIENT_CREDITS');

    // Verify balance unchanged
    const acct = await db.select().from(creditAccounts)
      .where(and(eq(creditAccounts.ownerType, 'organization'), eq(creditAccounts.ownerId, 'org1')))
      .limit(1);
    expect(acct[0].balance).toBe(100);
  });
});

// ========== AC3: Org admin read access ==========
describe('AC3: Org admin read-only access', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedOrg('org1', 'Test Org', 'test-org');
    await seedOrgBalance('org1', 500);
    await seedMembership('org1', 'admin1', 'org_admin');
  });

  it('org admin can read balance with full details', async () => {
    setUser('admin1');

    const res = await getBalance(
      new Request('http://localhost/api/organizations/org1/credits/balance'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(500);
    expect(body.accountId).toBeDefined();
    expect(body.ownerType).toBe('organization');
    expect(body.status).toBe('active');
  });

  it('org admin can read transactions', async () => {
    setUser('admin1');

    const res = await getTransactions(
      new NextRequest('http://localhost/api/organizations/org1/credits/transactions'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toEqual([]);
    expect(body.accountId).toBeDefined();
  });

  it('org admin cannot adjust credits', async () => {
    setUser('admin1');

    const res = await adjustOrgCredits(
      new Request('http://localhost/api/admin/organizations/org1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'self-deal', idempotencyKey: 'self-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(403);
  });
});

// ========== AC4: Regular user limited access ==========
describe('AC4: Regular member limited access', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
    await seedOrg('org1', 'Test Org', 'test-org', 'user1');
    await seedOrgBalance('org1', 500);
    await seedMembership('org1', 'user1', 'member');
  });

  it('regular member sees limited balance summary', async () => {
    setUser('user1');

    const res = await getBalance(
      new Request('http://localhost/api/organizations/org1/credits/balance'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(500);
    expect(body.ownerType).toBe('organization');
    // Should NOT have admin-level details
    expect(body).not.toHaveProperty('accountId');
    expect(body).not.toHaveProperty('status');
  });

  it('regular member cannot read transactions', async () => {
    setUser('user1');

    const res = await getTransactions(
      new NextRequest('http://localhost/api/organizations/org1/credits/transactions'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(403);
  });

  it('non-member gets 403', async () => {
    await seedUser('outsider', 'outsider@test.com');
    setUser('outsider');

    const res = await getBalance(
      new Request('http://localhost/api/organizations/org1/credits/balance'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(403);
  });
});

// ========== AC5: Cross-org protection ==========
describe('AC5: Cross-org accountId rejection', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedOrg('org2', 'Org Two', 'org-two');
    await seedOrgBalance('org1', 500);
    await seedOrgBalance('org2', 1000);
    await seedMembership('org1', 'admin1', 'org_admin');
    setUser('admin1');
  });

  it('balance endpoint ignores accountId param', async () => {
    const res = await getBalance(
      new Request('http://localhost/api/organizations/org1/credits/balance?accountId=fake-id'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(500); // Returns org1's balance, not fake
  });

  it('transactions endpoint ignores accountId param', async () => {
    const res = await getTransactions(
      new NextRequest('http://localhost/api/organizations/org1/credits/transactions?accountId=fake'),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return org1's account, not the fake one
    const org1Acct = await db.select().from(creditAccounts)
      .where(and(eq(creditAccounts.ownerType, 'organization'), eq(creditAccounts.ownerId, 'org1')))
      .limit(1);
    expect(body.accountId).toBe(org1Acct[0].id);
  });

  it('admin of org1 cannot access org2 balance', async () => {
    const res = await getBalance(
      new Request('http://localhost/api/organizations/org2/credits/balance'),
      { params: Promise.resolve({ orgId: 'org2' }) },
    );

    expect(res.status).toBe(403);
  });
});

// ========== Idempotency ==========
describe('Idempotency', () => {
  beforeEach(async () => {
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedOrg('org1', 'Test Org', 'test-org', 'super1');
    await seedOrgBalance('org1', 0);
    setSuperAdmin('super1');
  });

  it('duplicate idempotent request returns same balance', async () => {
    const body = { amount: 100, reason: 'test', idempotencyKey: 'org-idem-1' };
    const opts = { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    const params = { params: Promise.resolve({ orgId: 'org1' }) };

    const res1 = await adjustOrgCredits(new Request('http://localhost/api/admin/organizations/org1/adjust', opts), params);
    expect(res1.status).toBe(200);
    expect((await res1.json()).balance).toBe(100);

    const res2 = await adjustOrgCredits(new Request('http://localhost/api/admin/organizations/org1/adjust', opts), params);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.balance).toBe(100); // Still 100
    expect(body2.idempotent).toBe(true);
  });
});
