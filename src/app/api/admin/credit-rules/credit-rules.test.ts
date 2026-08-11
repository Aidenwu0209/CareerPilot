import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-028 tests: Super admin credit adjustment and credit rules API
 *
 * Validates:
 * - AC1: Adjustment requires non-zero integer, reason, and idempotency key
 * - AC2: Debit causing negative → INSUFFICIENT_CREDITS (422), no transaction
 * - AC3: Success returns new balance + transaction + audit event
 * - AC4: Rule update with non-negative value, versioned, old deactivated
 * - AC5: Duplicate idempotent request → no duplicate adjustment or audit
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
import { POST as adjustCredits } from '../users/[id]/adjust/route';
import { GET as listRules, PUT as updateRule } from './route';
import { db } from '@/lib/db';
import { users, creditAccounts, creditRules, creditTransactions } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({
    id, email, name: email.split('@')[0], authType: 'email',
  });
}

async function seedBalance(ownerId: string, balance: number) {
  await db.insert(creditAccounts).values({ ownerType: 'user', ownerId, balance });
}

function setAdmin() { ctxState.userId = 'admin1'; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setNormal() { ctxState.userId = 'normal1'; ctxState.role = 'user'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(creditRules);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

describe('AC1: Adjustment validation', () => {
  it('rejects zero amount', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t1', 't1@test.com');
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t1/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 0, reason: 'test', idempotencyKey: 'k1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't1' }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_AMOUNT');
  });

  it('rejects non-integer amount', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t2', 't2@test.com');
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t2/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 1.5, reason: 'test', idempotencyKey: 'k2' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't2' }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_AMOUNT');
  });

  it('rejects missing reason', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t3', 't3@test.com');
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t3/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, idempotencyKey: 'k3' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't3' }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('REASON_REQUIRED');
  });

  it('rejects missing idempotency key', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t4', 't4@test.com');
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t4/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't4' }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 403 for non-admin', async () => {
    await seedUser('normal1', 'normal@test.com');
    await seedUser('t5', 't5@test.com');
    setNormal();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t5/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test', idempotencyKey: 'k5' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't5' }) },
    );

    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated', async () => {
    setUnauth();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t6/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test', idempotencyKey: 'k6' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't6' }) },
    );

    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent user', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/nonexistent/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'test', idempotencyKey: 'k7' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    );

    expect(res.status).toBe(404);
  });
});

describe('AC2: Insufficient credits protection', () => {
  it('returns 422 INSUFFICIENT_CREDITS when debit exceeds balance', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t10', 't10@test.com');
    await seedBalance('t10', 50);
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t10/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: -100, reason: 'overdraft test', idempotencyKey: 'insuf-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't10' }) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INSUFFICIENT_CREDITS');

    // Verify no transaction was created
    const account = await db.select().from(creditAccounts).where(eq(creditAccounts.ownerId, 't10')).limit(1);
    const txns = await db.select().from(creditTransactions).where(eq(creditTransactions.accountId, account[0].id));
    expect(txns).toHaveLength(0);

    // Balance unchanged
    expect(account[0].balance).toBe(50);
  });
});

describe('AC3: Successful adjustment returns balance + transaction', () => {
  it('credits positive amount and returns new balance', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t20', 't20@test.com');
    await seedBalance('t20', 100);
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t20/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 50, reason: 'promotional credit', idempotencyKey: 'credit-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't20' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(150);
    expect(body.transaction).not.toBeNull();
    expect(body.transaction.delta).toBe(50);
    expect(body.transaction.balanceAfter).toBe(150);
    expect(body.transaction.reason).toBe('adjustment');
    expect(body.idempotent).toBe(false);
  });

  it('debits and returns new balance', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t21', 't21@test.com');
    await seedBalance('t21', 200);
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t21/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: -50, reason: 'correction', idempotencyKey: 'debit-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't21' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(150);
    expect(body.transaction.delta).toBe(-50);
    expect(body.transaction.balanceAfter).toBe(150);
  });

  it('allows debiting to exactly zero', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t22', 't22@test.com');
    await seedBalance('t22', 100);
    setAdmin();

    const res = await adjustCredits(
      new Request('http://localhost/api/admin/users/t22/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: -100, reason: 'drain to zero', idempotencyKey: 'drain-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't22' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe(0);
  });
});

describe('AC5: Idempotency', () => {
  it('duplicate request returns idempotent=true without duplicate adjustment', async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('t30', 't30@test.com');
    await seedBalance('t30', 0);
    setAdmin();

    // First call
    const res1 = await adjustCredits(
      new Request('http://localhost/api/admin/users/t30/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'first', idempotencyKey: 'dup-adj-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't30' }) },
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.balance).toBe(100);
    expect(body1.idempotent).toBe(false);

    // Second call with same key
    const res2 = await adjustCredits(
      new Request('http://localhost/api/admin/users/t30/adjust', {
        method: 'POST',
        body: JSON.stringify({ amount: 100, reason: 'second', idempotencyKey: 'dup-adj-1' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 't30' }) },
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.balance).toBe(100); // Still 100, not 200
    expect(body2.idempotent).toBe(true);
    expect(body2.transaction).toBeNull();
  });
});

describe('AC4: Credit rules management', () => {
  it('GET returns active rules (empty by default)', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await listRules();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toEqual([]);
  });

  it('GET returns 403 for non-admin', async () => {
    await seedUser('normal1', 'normal@test.com');
    setNormal();

    const res = await listRules();
    expect(res.status).toBe(403);
  });

  it('PUT creates a new rule with version 1', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'registration_grant', value: 200 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.ruleType).toBe('registration_grant');
    expect(body.rule.value).toBe(200);
    expect(body.rule.version).toBe(1);
    expect(body.rule.active).toBe(true);
  });

  it('PUT creates a new version and deactivates old', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    // Create v1
    await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'daily_limit_personal', value: 500 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    // Create v2
    const res2 = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'daily_limit_personal', value: 1000 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.rule.value).toBe(1000);
    expect(body2.rule.version).toBe(2);

    // Verify old rule is inactive
    const allRules = await db.select().from(creditRules).where(eq(creditRules.ruleType, 'daily_limit_personal'));
    expect(allRules).toHaveLength(2);
    const activeRules = allRules.filter((r: typeof allRules[number]) => r.active);
    expect(activeRules).toHaveLength(1);
    expect(activeRules[0].value).toBe(1000);
  });

  it('PUT rejects negative value', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'registration_grant', value: -1 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_VALUE');
  });

  it('PUT rejects invalid rule type', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'bogus_type', value: 100 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_RULE_TYPE');
  });

  it('PUT allows value 0', async () => {
    await seedUser('admin1', 'admin@test.com');
    setAdmin();

    const res = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'registration_grant', value: 0 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule.value).toBe(0);
  });

  it('PUT returns 403 for non-admin', async () => {
    await seedUser('normal1', 'normal@test.com');
    setNormal();

    const res = await updateRule(
      new Request('http://localhost/api/admin/credit-rules', {
        method: 'PUT',
        body: JSON.stringify({ ruleType: 'registration_grant', value: 100 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(403);
  });
});
