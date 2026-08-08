import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-026 tests: Balance & Transactions API routes
 *
 * Validates the HTTP API for personal balance and transactions:
 * - Unauthenticated → 401
 * - Suspended → 403
 * - Balance returns the current user's personal account data
 * - Transactions returns paginated results scoped to the user
 * - accountId parameter is never accepted (cross-account protection)
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

// --- Mock sample-resume ---
vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Mock @/lib/auth/guards without importing real next-auth ---
const ctxOverrides: { userId: string | null; suspended: boolean; orgContext: { type: 'organization'; id: string } | null } = {
  userId: null,
  suspended: false,
  orgContext: null,
};

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (ctxOverrides.userId === null) return null;
    if (ctxOverrides.suspended) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'ACCOUNT_SUSPENDED' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      };
    }
    const billing = ctxOverrides.orgContext
      ? { accountOwnerType: 'organization' as const, accountOwnerId: ctxOverrides.orgContext.id }
      : { accountOwnerType: 'user' as const, accountOwnerId: ctxOverrides.userId };
    return {
      ok: true as const,
      context: {
        actor: { userId: ctxOverrides.userId, platformRole: 'user' as const, status: 'active' as const },
        tenant: { type: 'none' as const, organizationId: null, orgRole: null },
        billing,
      },
    };
  }),
}));

// --- Import AFTER mocks ---
import { GET as getBalance } from './route';
import { GET as getTransactions } from '../transactions/route';
import { db } from '@/lib/db';
import { users, organizations } from '@/lib/db/schema';

async function seedUser(id: string, email: string, status: 'active' | 'suspended' = 'active') {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', status });
}

function setContext(userId: string | null, suspended = false) {
  ctxOverrides.userId = userId;
  ctxOverrides.suspended = suspended;
}

describe('GET /api/credits/balance', () => {
  it('returns 401 for unauthenticated requests', async () => {
    setContext(null);
    const res = await getBalance();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 403 for suspended users', async () => {
    setContext('susp-user', true);
    const res = await getBalance();
    expect(res.status).toBe(403);
  });

  it('returns the personal balance for an active user', async () => {
    await seedUser('b1', 'b1@test.com');
    setContext('b1');

    const res = await getBalance();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(body.ownerType).toBe('user');
    expect(body.ownerId).toBe('b1');
    expect(body.billingScope.type).toBe('personal');
  });

  it('reflects updated balance after credits are added', async () => {
    await seedUser('b2', 'b2@test.com');
    setContext('b2');

    // Add credits directly
    const { getOrCreateAccount, creditAccount } = await import('@/lib/credits/ledger');
    const account = await getOrCreateAccount('user', 'b2');
    creditAccount({ accountId: account.id, amount: 500, reason: 'manual_credit', idempotencyKey: 'r-1' });

    const res = await getBalance();
    const body = await res.json();
    expect(body.balance).toBe(500);
  });

  it('returns org name in billingScope for organization billing (US-068)', async () => {
    await seedUser('b3', 'b3@test.com');
    await db.insert(organizations).values({
      id: 'org-1',
      slug: 'test-org',
      name: 'Test Org',
      status: 'active',
      seatLimit: 10,
      createdBy: 'b3',
    });
    ctxOverrides.orgContext = { type: 'organization', id: 'org-1' };
    setContext('b3');

    const res = await getBalance();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.billingScope.type).toBe('organization');
    expect(body.billingScope.id).toBe('org-1');
    expect(body.billingScope.orgName).toBe('Test Org');
    expect(body.ownerType).toBe('organization');

    // Reset org context
    ctxOverrides.orgContext = null;
  });
});

describe('GET /api/credits/transactions', () => {
  it('returns 401 for unauthenticated requests', async () => {
    setContext(null);
    const req = new NextRequest('http://localhost/api/credits/transactions');
    const res = await getTransactions(req);
    expect(res.status).toBe(401);
  });

  it('returns empty transactions list for new user', async () => {
    await seedUser('b4', 'b4@test.com');
    setContext('b4');

    const req = new NextRequest('http://localhost/api/credits/transactions');
    const res = await getTransactions(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions).toEqual([]);
    expect(body.pagination.count).toBe(0);
  });

  it('returns paginated transactions', async () => {
    await seedUser('b5', 'b5@test.com');
    setContext('b5');

    const { getOrCreateAccount, creditAccount } = await import('@/lib/credits/ledger');
    const account = await getOrCreateAccount('user', 'b5');
    for (let i = 0; i < 5; i++) {
      creditAccount({ accountId: account.id, amount: 10, reason: 'manual_credit', idempotencyKey: `r5-${i}` });
    }

    const req = new NextRequest('http://localhost/api/credits/transactions?limit=2&offset=0');
    const res = await getTransactions(req);
    const body = await res.json();
    expect(body.transactions).toHaveLength(2);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.offset).toBe(0);
  });

  it('caps limit at 100', async () => {
    await seedUser('b6', 'b6@test.com');
    setContext('b6');

    const req = new NextRequest('http://localhost/api/credits/transactions?limit=999');
    const res = await getTransactions(req);
    const body = await res.json();
    expect(body.pagination.limit).toBe(100);
  });

  it('ignores accountId query parameter (cross-account protection)', async () => {
    await seedUser('b7', 'b7@test.com');
    setContext('b7');

    const req = new NextRequest('http://localhost/api/credits/transactions?accountId=nonexistent');
    const res = await getTransactions(req);
    const body = await res.json();
    expect(body.accountId).not.toBe('nonexistent');
  });
});
