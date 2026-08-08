import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-051 tests: Organization minimal usage summary API
 *
 * Validates:
 * - AC1: Org admin reads total consumption and remaining balance by time range
 * - AC2: By-member and by-model aggregation, totals consistent with org ledger
 * - AC3: Cross-org orgId/memberId/time params cannot read other tenant data
 * - AC4: Response excludes prompts, resumes, interview text, platform keys
 * - AC5: No-consumption period returns empty data and zero totals
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
import { GET as getUsage } from './route';
import { db } from '@/lib/db';
import {
  users,
  organizations,
  organizationMemberships,
  creditAccounts,
  creditTransactions,
  creditHolds,
  aiProviders,
  aiModels,
  aiOperations,
  aiProviderAttempts,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

// --- Seed helpers ---
async function seedUser(id: string, email: string, role: 'user' | 'super_admin' = 'user') {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email', platformRole: role });
}

async function seedOrg(id: string, name: string, slug: string, createdBy = 'admin1') {
  await db.insert(organizations).values({ id, name, slug, seatLimit: 10, status: 'active', createdBy });
}

async function seedMembership(orgId: string, userId: string, role: 'org_admin' | 'member' = 'member') {
  await db.insert(organizationMemberships).values({ organizationId: orgId, userId, role, status: 'active' });
}

async function seedOrgAccount(orgId: string, balance: number) {
  await db.insert(creditAccounts).values({ ownerType: 'organization', ownerId: orgId, balance });
}

async function seedProvider(id: string, type: string, name: string) {
  await db.insert(aiProviders).values({ id, type, name, status: 'active' });
}

async function seedModel(id: string, providerId: string, identifier: string, displayName: string) {
  await db.insert(aiModels).values({
    id, providerId, modelIdentifier: identifier, displayName,
    capabilities: ['text'], tier: 'standard', status: 'active', visibility: 'public',
  });
}

/**
 * Seeds a consumption transaction + ai_operation + provider attempt for a member.
 * All timestamps are set explicitly for time-range testing.
 */
async function seedConsumption(opts: {
  orgId: string;
  memberId: string;
  modelId: string;
  amount: number;
  daysAgo: number;
  status?: 'succeeded' | 'failed';
  capability?: string;
}) {
  const { orgId, memberId, modelId, amount, daysAgo, status = 'succeeded', capability = 'text' } = opts;

  // Get or create org account
  let account = (await db.select().from(creditAccounts)
    .where(eq(creditAccounts.ownerType, 'organization')).all())
    .find((a: { ownerId: string }) => a.ownerId === orgId);
  if (!account) {
    await seedOrgAccount(orgId, 1000);
    account = (await db.select().from(creditAccounts)
      .where(eq(creditAccounts.ownerType, 'organization')).all())
      .find((a: { ownerId: string }) => a.ownerId === orgId)!;
  }

  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  // Insert consumption transaction
  await db.insert(creditTransactions).values({
    accountId: account!.id,
    balanceBefore: account!.balance,
    delta: -amount,
    balanceAfter: account!.balance - amount,
    reason: 'consumption',
    idempotencyKey: `seed-${orgId}-${memberId}-${daysAgo}-${Math.random()}`,
    note: 'seeded consumption',
    createdAt: ts,
  });

  // Update account balance
  await db.update(creditAccounts).set({ balance: account!.balance - amount }).where(eq(creditAccounts.id, account!.id));

  // Insert AI operation
  const opId = `op-${orgId}-${memberId}-${daysAgo}-${Math.random()}`;
  await db.insert(aiOperations).values({
    id: opId,
    actorId: memberId,
    billingAccountId: account!.id,
    capability,
    status: status,
    idempotencyKey: `idem-${opId}`,
    createdAt: ts,
    updatedAt: ts,
  });

  // Insert provider attempt
  await db.insert(aiProviderAttempts).values({
    operationId: opId,
    modelId,
    attemptNumber: 1,
    status: status === 'succeeded' ? 'succeeded' : 'failed',
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    createdAt: ts,
    completedAt: ts,
  });
}

function setOrgAdmin(adminId: string) { ctxState.userId = adminId; ctxState.role = 'user'; ctxState.suspended = false; }
function setSuperAdmin(id: string) { ctxState.userId = id; ctxState.role = 'super_admin'; ctxState.suspended = false; }
function setUser(id: string) { ctxState.userId = id; ctxState.role = 'user'; ctxState.suspended = false; }
function setUnauth() { ctxState.userId = null; ctxState.role = 'user'; ctxState.suspended = false; }

function makeRequest(orgId: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost:3000/api/organizations/${orgId}/usage`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

beforeEach(async () => {
  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(aiProviderAttempts).catch(() => {});
  await db.delete(aiOperations).catch(() => {});
  await db.delete(creditHolds).catch(() => {});
  await db.delete(creditTransactions).catch(() => {});
  await db.delete(creditAccounts);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(aiModels).catch(() => {});
  await db.delete(aiProviders).catch(() => {});
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== AC1: Org admin reads total consumption and remaining balance ==========
describe('AC1: Total consumption and remaining balance', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('super1', 'super@test.com', 'super_admin');
    await seedUser('member1', 'member1@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedOrg('org2', 'Org Two', 'org-two');
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org1', 'member1', 'member');
    await seedProvider('prov1', 'openai', 'OpenAI');
    await seedModel('model1', 'prov1', 'gpt-4', 'GPT-4');
    await seedModel('model2', 'prov1', 'gpt-3.5', 'GPT-3.5');
    await seedOrgAccount('org1', 800);
  });

  it('returns total consumed and remaining balance', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 5 });
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model2', amount: 30, daysAgo: 2 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.totalConsumed).toBe(80);
    expect(body.summary.remainingBalance).toBe(720);
    expect(body.summary.totalOperations).toBe(2);
    expect(body.summary.period.from).toBeDefined();
    expect(body.summary.period.to).toBeDefined();
  });

  it('respects time range filter', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 20 });
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 30, daysAgo: 3 });

    setOrgAdmin('admin1');
    const from = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const res = await getUsage(makeRequest('org1', { from, to }), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.totalConsumed).toBe(30);
    expect(body.summary.totalOperations).toBe(1);
  });

  it('returns 400 for invalid time range', async () => {
    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1', { from: 'not-a-date' }), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_TIME_RANGE');
  });

  it('super admin can access org usage', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setSuperAdmin('super1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.totalConsumed).toBe(50);
  });
});

// ========== AC2: By-member and by-model aggregation ==========
describe('AC2: Member and model aggregation consistency', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('member1', 'member1@test.com');
    await seedUser('member2', 'member2@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org1', 'member1', 'member');
    await seedMembership('org1', 'member2', 'member');
    await seedProvider('prov1', 'openai', 'OpenAI');
    await seedModel('model1', 'prov1', 'gpt-4', 'GPT-4');
    await seedModel('model2', 'prov1', 'gpt-3.5', 'GPT-3.5');
    await seedOrgAccount('org1', 1000);
  });

  it('aggregates consumption by member', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 20, daysAgo: 1 });
    await seedConsumption({ orgId: 'org1', memberId: 'member2', modelId: 'model2', amount: 30, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    expect(body.byMember).toHaveLength(2);
    const m1 = body.byMember.find((m: { userId: string }) => m.userId === 'member1');
    const m2 = body.byMember.find((m: { userId: string }) => m.userId === 'member2');
    expect(m1.operations).toBe(2);
    expect(m2.operations).toBe(1);
    expect(m1.email).toBe('member1@test.com');
    expect(m2.name).toBe('member2');
  });

  it('aggregates attempts by model', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });
    await seedConsumption({ orgId: 'org1', memberId: 'member2', modelId: 'model2', amount: 30, daysAgo: 1 });
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 10, daysAgo: 1, status: 'failed' });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    const md1 = body.byModel.find((m: { modelId: string }) => m.modelId === 'model1');
    const md2 = body.byModel.find((m: { modelId: string }) => m.modelId === 'model2');
    expect(md1.attempts).toBe(2);
    expect(md1.succeeded).toBe(1);
    expect(md1.failed).toBe(1);
    expect(md2.attempts).toBe(1);
    expect(md2.succeeded).toBe(1);
    expect(md1.displayName).toBe('GPT-4');
  });

  it('member + model totals are consistent with ledger', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 3 });
    await seedConsumption({ orgId: 'org1', memberId: 'member2', modelId: 'model2', amount: 30, daysAgo: 2 });
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model2', amount: 20, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    // Summary total should equal sum of seeded consumption amounts
    expect(body.summary.totalConsumed).toBe(100);

    // Member operation counts sum should equal total operations
    const memberOpsSum = body.byMember.reduce((s: number, m: { operations: number }) => s + m.operations, 0);
    expect(memberOpsSum).toBe(body.summary.totalOperations);

    // Model attempt counts sum should equal total attempts across models
    const modelAttemptsSum = body.byModel.reduce((s: number, m: { attempts: number }) => s + m.attempts, 0);
    expect(modelAttemptsSum).toBe(body.summary.totalOperations);
  });

  it('supports pagination on member usage', async () => {
    // Seed 3 members
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 10, daysAgo: 1 });
    await seedConsumption({ orgId: 'org1', memberId: 'member2', modelId: 'model1', amount: 10, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(
      makeRequest('org1', { limit: '1', offset: '0' }),
      { params: Promise.resolve({ orgId: 'org1' }) },
    );
    const body = await res.json();

    expect(body.byMember).toHaveLength(1);
    expect(body.pagination).toEqual({ limit: 1, offset: 0 });
  });
});

// ========== AC3: Cross-tenant isolation ==========
describe('AC3: Cross-org tenant isolation', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin1@test.com');
    await seedUser('admin2', 'admin2@test.com');
    await seedUser('member1', 'member1@test.com');
    await seedUser('member2', 'member2@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedOrg('org2', 'Org Two', 'org-two');
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org2', 'admin2', 'org_admin');
    await seedMembership('org1', 'member1', 'member');
    await seedMembership('org2', 'member2', 'member');
    await seedProvider('prov1', 'openai', 'OpenAI');
    await seedModel('model1', 'prov1', 'gpt-4', 'GPT-4');
    await seedOrgAccount('org1', 1000);
    await seedOrgAccount('org2', 500);
  });

  it('org1 admin cannot read org2 usage', async () => {
    await seedConsumption({ orgId: 'org2', memberId: 'member2', modelId: 'model1', amount: 50, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org2'), { params: Promise.resolve({ orgId: 'org2' }) });
    expect(res.status).toBe(403);
  });

  it('org admin calling different orgId gets no data', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });
    await seedConsumption({ orgId: 'org2', memberId: 'member2', modelId: 'model1', amount: 30, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res1 = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body1 = await res1.json();
    expect(body1.summary.totalConsumed).toBe(50);

    // Attempt org2 - should be rejected
    const res2 = await getUsage(makeRequest('org2'), { params: Promise.resolve({ orgId: 'org2' }) });
    expect(res2.status).toBe(403);
  });

  it('non-member user gets 403', async () => {
    await seedUser('outsider', 'outsider@test.com');
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setUser('outsider');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setUnauth();
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(401);
  });

  it('regular member (not org_admin) gets 403', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setUser('member1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    expect(res.status).toBe(403);
  });
});

// ========== AC4: No sensitive data in response ==========
describe('AC4: Response excludes sensitive data', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('member1', 'member1@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org1', 'member1', 'member');
    await seedProvider('prov1', 'openai', 'OpenAI');
    await seedModel('model1', 'prov1', 'gpt-4', 'GPT-4');
    await seedOrgAccount('org1', 1000);
  });

  it('response does not contain prompts, resume text, or credentials', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    // Should not contain sensitive data fields
    expect(bodyStr).not.toContain('apiKey');
    expect(bodyStr).not.toContain('api_key');
    expect(bodyStr).not.toContain('encryptedCredentials');
    expect(bodyStr).not.toContain('prompt');
    expect(bodyStr).not.toContain('resume');
    expect(bodyStr).not.toContain('interview');
    expect(bodyStr).not.toContain('authorization');
    expect(bodyStr).not.toContain('Bearer');
  });

  it('byMember entries only contain email, name, and counts', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    for (const m of body.byMember) {
      const keys = Object.keys(m).sort();
      expect(keys).toEqual(['email', 'failed', 'name', 'operations', 'succeeded', 'userId']);
    }
  });

  it('byModel entries only contain modelId, displayName, and counts', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 1 });

    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    for (const m of body.byModel) {
      const keys = Object.keys(m).sort();
      expect(keys).toEqual(['attempts', 'displayName', 'failed', 'modelId', 'succeeded']);
    }
  });
});

// ========== AC5: No-consumption period returns empty ==========
describe('AC5: Empty period returns zero totals', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'admin@test.com');
    await seedUser('member1', 'member1@test.com');
    await seedOrg('org1', 'Org One', 'org-one');
    await seedMembership('org1', 'admin1', 'org_admin');
    await seedMembership('org1', 'member1', 'member');
    await seedProvider('prov1', 'openai', 'OpenAI');
    await seedModel('model1', 'prov1', 'gpt-4', 'GPT-4');
    await seedOrgAccount('org1', 500);
  });

  it('returns zero totals for org with no consumption', async () => {
    setOrgAdmin('admin1');
    const res = await getUsage(makeRequest('org1'), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    expect(body.summary.totalConsumed).toBe(0);
    expect(body.summary.totalOperations).toBe(0);
    expect(body.summary.remainingBalance).toBe(500);
    expect(body.byMember).toEqual([]);
    expect(body.byModel).toEqual([]);
  });

  it('returns empty when time range excludes all consumption', async () => {
    await seedConsumption({ orgId: 'org1', memberId: 'member1', modelId: 'model1', amount: 50, daysAgo: 10 });

    setOrgAdmin('admin1');
    // Query only the last 3 days — consumption is 10 days ago
    const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const res = await getUsage(makeRequest('org1', { from, to }), { params: Promise.resolve({ orgId: 'org1' }) });
    const body = await res.json();

    expect(body.summary.totalConsumed).toBe(0);
    expect(body.summary.totalOperations).toBe(0);
    expect(body.byMember).toEqual([]);
    expect(body.byModel).toEqual([]);
  });
});
