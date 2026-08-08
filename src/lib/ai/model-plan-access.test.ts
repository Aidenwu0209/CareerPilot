import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import { aiModels, aiProviders, billingPlans, creditAccounts, paymentOrders, planModelAccess, users } from '@/lib/db/schema';
import { getUserCatalog, validateModelAccess } from './model-catalog';

beforeEach(async () => {
  await db.delete(paymentOrders); await db.delete(planModelAccess); await db.delete(billingPlans);
  await db.delete(aiModels); await db.delete(aiProviders); await db.delete(creditAccounts); await db.delete(users);
  await db.insert(users).values({ id: 'u1', authType: 'email' });
  await db.insert(creditAccounts).values({ id: 'a1', ownerType: 'user', ownerId: 'u1' });
  await db.insert(aiProviders).values({ id: 'p1', type: 'openai', name: 'OpenAI' });
  await db.insert(aiModels).values([
    { id: 'm-free', providerId: 'p1', modelIdentifier: 'gpt-basic', displayName: 'GPT Basic', family: 'gpt' },
    { id: 'm-pro', providerId: 'p1', modelIdentifier: 'gpt-pro', displayName: 'GPT Pro', family: 'gpt' },
  ]);
  await db.insert(billingPlans).values([
    { id: 'free', code: 'free', name: 'Free', kind: 'credit_pack', userLevel: 'free', priceMinor: 0, credits: 0 },
    { id: 'pro', code: 'pro', name: 'Pro', kind: 'credit_pack', userLevel: 'pro', priceMinor: 4900, credits: 1000 },
  ]);
  await db.insert(planModelAccess).values([
    { planId: 'free', modelId: 'm-free' }, { planId: 'pro', modelId: 'm-pro' },
  ]);
});

describe('plan-bound model access', () => {
  it('only exposes the free plan model before purchase', async () => {
    expect((await getUserCatalog('u1')).map((model) => model.id)).toEqual(['m-free']);
    expect((await validateModelAccess('m-pro', 'u1')).ok).toBe(false);
  });

  it('adds the purchased plan model after payment', async () => {
    await db.insert(paymentOrders).values({
      id: 'o1', userId: 'u1', accountId: 'a1', planId: 'pro', status: 'paid',
      amountMinor: 4900, paidMinor: 4900, currency: 'cny', credits: 1000, idempotencyKey: 'o1',
    });
    expect(new Set((await getUserCatalog('u1')).map((model) => model.id))).toEqual(new Set(['m-free', 'm-pro']));
    expect((await validateModelAccess('m-pro', 'u1')).ok).toBe(true);
  });
});
