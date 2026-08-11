import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';

const provider = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  createRefund: vi.fn(),
  retrievePayment: vi.fn(),
}));

vi.mock('@/lib/config', () => ({ config: { db: { type: 'sqlite' } } }));
vi.mock('./provider', () => ({ getPaymentProvider: () => provider }));
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
import { billingPlans, creditAccounts, creditTransactions, paymentOrders, paymentRefunds, users } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { createCheckout, fulfillCreditOrder, requestRefund } from './service';

async function seed() {
  await db.insert(users).values({ id: 'user-1', email: 'u@example.com', authType: 'email' });
  await db.insert(creditAccounts).values({ id: 'account-1', ownerType: 'user', ownerId: 'user-1' });
  await db.insert(billingPlans).values({
    id: 'plan-1', code: 'starter', name: 'Starter', kind: 'credit_pack',
    userLevel: 'starter', priceMinor: 1900, currency: 'cny', credits: 100,
  });
}

beforeEach(async () => {
  db.run(sql`DROP TRIGGER IF EXISTS credit_transactions_no_delete`);
  await db.delete(paymentRefunds);
  await db.delete(paymentOrders);
  await db.delete(creditTransactions);
  await db.delete(billingPlans);
  await db.delete(creditAccounts);
  await db.delete(users);
  db.run(sql`CREATE TRIGGER credit_transactions_no_delete BEFORE DELETE ON credit_transactions BEGIN SELECT RAISE(ABORT, 'credit_transactions is immutable'); END`);
  provider.createCheckout.mockReset().mockResolvedValue({ providerOrderId: 'cs_test', checkoutUrl: 'https://checkout.stripe.test/session' });
  provider.retrievePayment.mockReset().mockResolvedValue({ providerOrderId: 'cs_test', paymentStatus: 'unpaid', amountTotal: 1900, currency: 'cny', paymentId: null });
  provider.createRefund.mockReset().mockResolvedValue({ providerRefundId: 're_test', status: 'succeeded' });
  await seed();
});

describe('ToC billing service', () => {
  it('creates a server-priced checkout and reuses the idempotency key', async () => {
    const first = await createCheckout({ userId: 'user-1', planId: 'plan-1', idempotencyKey: 'attempt-1', origin: 'https://app.example.com', locale: 'zh' });
    const second = await createCheckout({ userId: 'user-1', planId: 'plan-1', idempotencyKey: 'attempt-1', origin: 'https://app.example.com', locale: 'zh' });
    expect(first.orderId).toBe(second.orderId);
    const orders = await db.select().from(paymentOrders);
    expect(orders).toHaveLength(1);
    expect(orders[0].amountMinor).toBe(1900);
    expect(orders[0].credits).toBe(100);
  });

  it('fulfills a paid order exactly once even when the webhook is replayed', async () => {
    await db.insert(paymentOrders).values({
      id: 'order-1', userId: 'user-1', accountId: 'account-1', planId: 'plan-1',
      amountMinor: 1900, currency: 'cny', credits: 100, idempotencyKey: 'order-1',
    });
    await fulfillCreditOrder('order-1', 'pi_test');
    await fulfillCreditOrder('order-1', 'pi_test');
    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.id, 'account-1'));
    const ledger = await db.select().from(creditTransactions).where(eq(creditTransactions.businessRefId, 'order-1'));
    expect(account.balance).toBe(100);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].reason).toBe('purchase_credit');
  });

  it('reverses credits and marks a successful full refund', async () => {
    await db.insert(paymentOrders).values({
      id: 'order-1', userId: 'user-1', accountId: 'account-1', planId: 'plan-1',
      amountMinor: 1900, currency: 'cny', credits: 100, idempotencyKey: 'order-1',
    });
    await fulfillCreditOrder('order-1', 'pi_test');
    const result = await requestRefund({ userId: 'user-1', orderId: 'order-1' });
    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.id, 'account-1'));
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, 'order-1'));
    expect(result.status).toBe('succeeded');
    expect(account.balance).toBe(0);
    expect(order.status).toBe('refunded');
    expect(order.refundedMinor).toBe(1900);
  });

  it('rolls credits back if the payment provider rejects the refund', async () => {
    provider.createRefund.mockRejectedValueOnce(new Error('provider unavailable'));
    await db.insert(paymentOrders).values({
      id: 'order-1', userId: 'user-1', accountId: 'account-1', planId: 'plan-1',
      amountMinor: 1900, currency: 'cny', credits: 100, idempotencyKey: 'order-1',
    });
    await fulfillCreditOrder('order-1', 'pi_test');
    await expect(requestRefund({ userId: 'user-1', orderId: 'order-1' })).rejects.toThrow('provider unavailable');
    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.id, 'account-1'));
    const ledger = await db.select().from(creditTransactions).where(eq(creditTransactions.accountId, 'account-1'));
    expect(account.balance).toBe(100);
    expect(ledger.map((entry: typeof creditTransactions.$inferSelect) => entry.reason)).toEqual(['purchase_credit', 'payment_refund', 'payment_refund_rollback']);
  });
});
