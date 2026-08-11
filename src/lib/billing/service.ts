import { createHash } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '@/lib/db';
import {
  billingPlans,
  paymentOrders,
  paymentRefunds,
  paymentWebhookEvents,
  reconciliationItems,
  reconciliationRuns,
  userEntitlements,
  users,
} from '@/lib/db/schema';
import { getOrCreateAccount } from '@/lib/credits/ledger';
import { creditAccountPortable, debitAccountPortable } from '@/lib/credits/portable-ledger';
import { getPaymentProvider } from './provider';
import { getStripeClient } from './stripe-provider';

export class BillingError extends Error {
  constructor(public code: string, message = code) {
    super(message);
    this.name = 'BillingError';
  }
}

export async function listActivePlans() {
  const plans = await db.select().from(billingPlans)
    .where(eq(billingPlans.active, true))
    .orderBy(billingPlans.sortOrder, billingPlans.priceMinor);
  return plans.filter((plan: typeof billingPlans.$inferSelect) => plan.priceMinor > 0 && plan.credits > 0);
}

export async function listUserOrders(userId: string, limit = 50) {
  return db.select({
    order: paymentOrders,
    planName: billingPlans.name,
    planCode: billingPlans.code,
  }).from(paymentOrders)
    .innerJoin(billingPlans, eq(paymentOrders.planId, billingPlans.id))
    .where(eq(paymentOrders.userId, userId))
    .orderBy(desc(paymentOrders.createdAt))
    .limit(limit);
}

export async function getUserSubscription(userId: string) {
  const [row] = await db.select({ entitlement: userEntitlements, plan: billingPlans })
    .from(userEntitlements).innerJoin(billingPlans, eq(userEntitlements.planId, billingPlans.id))
    .where(and(eq(userEntitlements.userId, userId), inArray(userEntitlements.status, ['active', 'past_due'])))
    .orderBy(desc(userEntitlements.updatedAt)).limit(1);
  return row ?? null;
}

export async function createCustomerPortal(userId: string, returnUrl: string) {
  const subscription = await getUserSubscription(userId);
  if (!subscription?.entitlement.externalCustomerId) throw new BillingError('SUBSCRIPTION_NOT_FOUND');
  const session = await getStripeClient().billingPortal.sessions.create({
    customer: subscription.entitlement.externalCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

export async function createCheckout(params: {
  userId: string;
  planId: string;
  idempotencyKey: string;
  origin: string;
  locale: string;
}) {
  const [plan] = await db.select().from(billingPlans).where(and(
    eq(billingPlans.id, params.planId),
    eq(billingPlans.active, true),
  )).limit(1);
  if (!plan) throw new BillingError('PLAN_NOT_AVAILABLE');
  if (plan.priceMinor <= 0 || plan.credits <= 0) throw new BillingError('PLAN_NOT_SELLABLE');
  if (plan.kind === 'subscription' && !plan.billingInterval) {
    throw new BillingError('PLAN_INTERVAL_REQUIRED');
  }

  const account = await getOrCreateAccount('user', params.userId);
  if (account.status !== 'active') throw new BillingError('ACCOUNT_FROZEN');
  const [user] = await db.select({ email: users.email }).from(users)
    .where(eq(users.id, params.userId)).limit(1);
  const stableKey = `checkout:${params.userId}:${params.idempotencyKey}`;
  const [existing] = await db.select().from(paymentOrders)
    .where(eq(paymentOrders.idempotencyKey, stableKey)).limit(1);
  if (existing?.providerOrderId) {
    const snapshot = await getPaymentProvider('stripe').retrievePayment(existing.providerOrderId);
    if (snapshot.paymentStatus === 'paid') {
      return { orderId: existing.id, checkoutUrl: null, status: existing.status };
    }
  }

  const orderId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await db.insert(paymentOrders).values({
      id: orderId,
      userId: params.userId,
      accountId: account.id,
      planId: plan.id,
      provider: 'stripe',
      amountMinor: plan.priceMinor,
      currency: plan.currency.toLowerCase(),
      credits: plan.credits,
      idempotencyKey: stableKey,
      metadata: { planCode: plan.code, userLevel: plan.userLevel },
    });
  }

  try {
    const result = await getPaymentProvider('stripe').createCheckout({
      orderId,
      userId: params.userId,
      accountId: account.id,
      planId: plan.id,
      planName: plan.name,
      kind: plan.kind,
      amountMinor: plan.priceMinor,
      currency: plan.currency.toLowerCase(),
      interval: plan.billingInterval,
      customerEmail: user?.email,
      successUrl: `${params.origin}/${params.locale}/credits?payment=success&order_id=${orderId}`,
      cancelUrl: `${params.origin}/${params.locale}/credits?payment=canceled`,
    });
    await db.update(paymentOrders).set({
      providerOrderId: result.providerOrderId,
      status: 'pending',
      updatedAt: new Date(),
    }).where(eq(paymentOrders.id, orderId));
    return { orderId, checkoutUrl: result.checkoutUrl, status: 'pending' as const };
  } catch (error) {
    await db.update(paymentOrders).set({
      status: 'failed',
      metadata: { error: error instanceof Error ? error.message : 'CHECKOUT_FAILED' },
      updatedAt: new Date(),
    }).where(eq(paymentOrders.id, orderId));
    throw error;
  }
}

export async function fulfillCreditOrder(orderId: string, providerPaymentId: string | null) {
  const [order] = await db.select({ order: paymentOrders, plan: billingPlans })
    .from(paymentOrders)
    .innerJoin(billingPlans, eq(paymentOrders.planId, billingPlans.id))
    .where(eq(paymentOrders.id, orderId)).limit(1);
  if (!order) throw new BillingError('ORDER_NOT_FOUND');

  const reason = order.plan.kind === 'subscription' ? 'subscription_credit' : 'purchase_credit';
  const result = await creditAccountPortable({
    accountId: order.order.accountId,
    amount: order.order.credits,
    reason,
    businessRefId: order.order.id,
    idempotencyKey: `payment-credit:${order.order.id}`,
    operatorId: 'payment:stripe',
    ruleSnapshot: {
      planId: order.plan.id,
      planCode: order.plan.code,
      amountMinor: order.order.amountMinor,
      currency: order.order.currency,
    },
    note: `Stripe payment credit for ${order.plan.name}`,
  });
  await db.update(paymentOrders).set({
    status: 'paid',
    paidMinor: order.order.amountMinor,
    providerPaymentId: providerPaymentId ?? order.order.providerPaymentId,
    paidAt: order.order.paidAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(paymentOrders.id, order.order.id));
  return result;
}

export async function requestRefund(params: {
  userId: string;
  orderId: string;
  amountMinor?: number;
  reason?: string;
  allowAnyUser?: boolean;
}) {
  const [order] = await db.select().from(paymentOrders)
    .where(eq(paymentOrders.id, params.orderId)).limit(1);
  if (!order || (!params.allowAnyUser && order.userId !== params.userId)) {
    throw new BillingError('ORDER_NOT_FOUND');
  }
  if (!order.providerPaymentId || !['paid', 'partially_refunded'].includes(order.status)) {
    throw new BillingError('ORDER_NOT_REFUNDABLE');
  }
  const refundable = order.paidMinor - order.refundedMinor;
  const amountMinor = params.amountMinor ?? refundable;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > refundable) {
    throw new BillingError('INVALID_REFUND_AMOUNT');
  }
  const creditsReversed = Math.ceil(order.credits * amountMinor / order.amountMinor);
  const refundId = crypto.randomUUID();
  await db.insert(paymentRefunds).values({
    id: refundId,
    orderId: order.id,
    amountMinor,
    creditsReversed,
    reason: params.reason ?? 'customer_request',
    requestedBy: params.userId,
  });

  // Reserve the refundable credits first. If Stripe rejects the refund, the
  // exact amount is credited back with a separate immutable rollback entry.
  await debitAccountPortable({
    accountId: order.accountId,
    amount: creditsReversed,
    reason: 'payment_refund',
    businessRefId: refundId,
    idempotencyKey: `payment-refund:${refundId}`,
    operatorId: params.userId,
    note: `Reserved credits for refund ${refundId}`,
  });
  await db.update(paymentOrders).set({ status: 'refund_pending', updatedAt: new Date() })
    .where(eq(paymentOrders.id, order.id));

  try {
    const providerRefund = await getPaymentProvider('stripe').createRefund({
      paymentId: order.providerPaymentId,
      amountMinor,
      refundId,
      reason: params.reason ?? 'customer_request',
    });
    await db.update(paymentRefunds).set({
      providerRefundId: providerRefund.providerRefundId,
      status: 'pending',
      updatedAt: new Date(),
    }).where(eq(paymentRefunds.id, refundId));
    if (providerRefund.status === 'succeeded') {
      await finalizeRefund(refundId);
    } else if (providerRefund.status === 'failed' || providerRefund.status === 'canceled') {
      await rollbackRefund(refundId, `Provider status: ${providerRefund.status}`);
    }
    return { refundId, status: providerRefund.status, amountMinor, creditsReversed };
  } catch (error) {
    await rollbackRefund(refundId, error instanceof Error ? error.message : 'REFUND_FAILED');
    throw error;
  }
}

async function finalizeRefund(refundId: string) {
  const [row] = await db.select({ refund: paymentRefunds, order: paymentOrders })
    .from(paymentRefunds).innerJoin(paymentOrders, eq(paymentRefunds.orderId, paymentOrders.id))
    .where(eq(paymentRefunds.id, refundId)).limit(1);
  if (!row || row.refund.status === 'succeeded') return;
  const newRefunded = row.order.refundedMinor + row.refund.amountMinor;
  await db.update(paymentRefunds).set({ status: 'succeeded', updatedAt: new Date() })
    .where(eq(paymentRefunds.id, refundId));
  await db.update(paymentOrders).set({
    refundedMinor: newRefunded,
    status: newRefunded >= row.order.paidMinor ? 'refunded' : 'partially_refunded',
    updatedAt: new Date(),
  }).where(eq(paymentOrders.id, row.order.id));
}

async function rollbackRefund(refundId: string, failureReason: string) {
  const [row] = await db.select({ refund: paymentRefunds, order: paymentOrders })
    .from(paymentRefunds).innerJoin(paymentOrders, eq(paymentRefunds.orderId, paymentOrders.id))
    .where(eq(paymentRefunds.id, refundId)).limit(1);
  if (!row || row.refund.status === 'failed' || row.refund.status === 'canceled') return;
  await creditAccountPortable({
    accountId: row.order.accountId,
    amount: row.refund.creditsReversed,
    reason: 'payment_refund_rollback',
    businessRefId: refundId,
    idempotencyKey: `payment-refund-rollback:${refundId}`,
    operatorId: 'payment:stripe',
    note: `Refund rollback: ${failureReason}`,
  });
  await db.update(paymentRefunds).set({ status: 'failed', failureReason, updatedAt: new Date() })
    .where(eq(paymentRefunds.id, refundId));
  await db.update(paymentOrders).set({
    status: row.order.refundedMinor > 0 ? 'partially_refunded' : 'paid',
    updatedAt: new Date(),
  }).where(eq(paymentOrders.id, row.order.id));
}

export async function processStripeEvent(event: Stripe.Event, rawPayload: string) {
  const payloadHash = createHash('sha256').update(rawPayload).digest('hex');
  const [known] = await db.select().from(paymentWebhookEvents).where(and(
    eq(paymentWebhookEvents.provider, 'stripe'),
    eq(paymentWebhookEvents.eventId, event.id),
  )).limit(1);
  if (known?.status === 'processed' || known?.status === 'ignored') return { duplicate: true };
  if (!known) {
    await db.insert(paymentWebhookEvents).values({
      provider: 'stripe', eventId: event.id, eventType: event.type, payloadHash,
    });
  } else {
    await db.update(paymentWebhookEvents).set({ status: 'processing', errorMessage: null })
      .where(eq(paymentWebhookEvents.id, known.id));
  }

  try {
    const handled = await handleStripeEvent(event);
    await db.update(paymentWebhookEvents).set({
      status: handled ? 'processed' : 'ignored', processedAt: new Date(), errorMessage: null,
    }).where(and(eq(paymentWebhookEvents.provider, 'stripe'), eq(paymentWebhookEvents.eventId, event.id)));
    return { duplicate: false, handled };
  } catch (error) {
    await db.update(paymentWebhookEvents).set({
      status: 'failed', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_ERROR',
    }).where(and(eq(paymentWebhookEvents.provider, 'stripe'), eq(paymentWebhookEvents.eventId, event.id)));
    throw error;
  }
}

async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId ?? session.client_reference_id;
    if (!orderId) throw new BillingError('WEBHOOK_ORDER_ID_MISSING');
    const [joined] = await db.select({ order: paymentOrders, plan: billingPlans })
      .from(paymentOrders).innerJoin(billingPlans, eq(paymentOrders.planId, billingPlans.id))
      .where(eq(paymentOrders.id, orderId)).limit(1);
    if (!joined) throw new BillingError('ORDER_NOT_FOUND');
    const paymentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    await db.update(paymentOrders).set({
      providerPaymentId: paymentId,
      providerCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      providerSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    }).where(eq(paymentOrders.id, orderId));
    if (joined.plan.kind === 'credit_pack' && session.payment_status === 'paid') {
      await fulfillCreditOrder(orderId, paymentId);
    }
    return true;
  }

  if (event.type === 'invoice.paid') {
    // Stripe's invoice shape differs by API version; retrieve the subscription
    // to obtain our immutable order metadata in one canonical place.
    const invoice = event.data.object as Stripe.Invoice;
    const rawInvoice = invoice as unknown as Record<string, unknown>;
    const parent = rawInvoice.parent as { subscription_details?: { subscription?: string } } | undefined;
    const subscriptionId = parent?.subscription_details?.subscription
      ?? (typeof rawInvoice.subscription === 'string' ? rawInvoice.subscription : undefined);
    if (!subscriptionId) return false;
    const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    const baseOrderId = subscription.metadata.orderId;
    if (!baseOrderId) throw new BillingError('WEBHOOK_ORDER_ID_MISSING');
    const [base] = await db.select({ order: paymentOrders, plan: billingPlans })
      .from(paymentOrders).innerJoin(billingPlans, eq(paymentOrders.planId, billingPlans.id))
      .where(eq(paymentOrders.id, baseOrderId)).limit(1);
    if (!base) throw new BillingError('ORDER_NOT_FOUND');
    const invoiceId = invoice.id;
    const paidInvoicePayment = invoice.payments?.data.find((payment) => payment.status === 'paid');
    const invoicePaymentIntent = paidInvoicePayment?.payment.payment_intent;
    const paymentIntentId = typeof invoicePaymentIntent === 'string'
      ? invoicePaymentIntent
      : invoicePaymentIntent?.id ?? null;
    const [existingInvoiceOrder] = await db.select().from(paymentOrders)
      .where(eq(paymentOrders.idempotencyKey, `stripe-invoice:${invoiceId}`)).limit(1);
    const orderId = existingInvoiceOrder?.id ?? (base.order.status === 'pending' ? base.order.id : crypto.randomUUID());
    if (!existingInvoiceOrder && orderId !== base.order.id) {
      await db.insert(paymentOrders).values({
        id: orderId,
        userId: base.order.userId,
        accountId: base.order.accountId,
        planId: base.order.planId,
        provider: 'stripe',
        providerOrderId: invoiceId,
        providerPaymentId: paymentIntentId,
        providerCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
        providerSubscriptionId: subscriptionId,
        amountMinor: invoice.amount_paid,
        currency: invoice.currency,
        credits: base.plan.credits,
        idempotencyKey: `stripe-invoice:${invoiceId}`,
        metadata: { renewalOf: baseOrderId },
      });
    }
    await fulfillCreditOrder(orderId, paymentIntentId);
    const periodStart = new Date(subscription.items.data[0]?.current_period_start * 1000);
    const periodEnd = new Date(subscription.items.data[0]?.current_period_end * 1000);
    const [entitlement] = await db.select().from(userEntitlements)
      .where(eq(userEntitlements.externalSubscriptionId, subscriptionId)).limit(1);
    const entitlementValues = {
      userId: base.order.userId,
      planId: base.plan.id,
      status: 'active' as const,
      provider: 'stripe',
      externalCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      externalSubscriptionId: subscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(),
    };
    if (entitlement) {
      await db.update(userEntitlements).set(entitlementValues).where(eq(userEntitlements.id, entitlement.id));
    } else {
      await db.insert(userEntitlements).values(entitlementValues);
    }
    return true;
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    await db.update(userEntitlements).set({
      status: event.type === 'customer.subscription.deleted' ? 'canceled'
        : subscription.status === 'active' || subscription.status === 'trialing' ? 'active'
          : subscription.status === 'past_due' ? 'past_due' : 'canceled',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: new Date((subscription.items.data[0]?.current_period_end ?? 0) * 1000),
      updatedAt: new Date(),
    }).where(eq(userEntitlements.externalSubscriptionId, subscription.id));
    return true;
  }

  if (event.type === 'refund.updated' || event.type === 'refund.created') {
    const refund = event.data.object as Stripe.Refund;
    const [local] = await db.select().from(paymentRefunds)
      .where(eq(paymentRefunds.providerRefundId, refund.id)).limit(1);
    if (!local) return false;
    if (refund.status === 'succeeded') await finalizeRefund(local.id);
    if (refund.status === 'failed' || refund.status === 'canceled') {
      await rollbackRefund(local.id, refund.failure_reason ?? `Provider status: ${refund.status}`);
    }
    return true;
  }
  return false;
}

export async function reconcileStripe(startedBy: string, limit = 100) {
  const runId = crypto.randomUUID();
  await db.insert(reconciliationRuns).values({ id: runId, provider: 'stripe', startedBy });
  try {
    const orders = await db.select().from(paymentOrders)
      .where(and(eq(paymentOrders.provider, 'stripe'), inArray(paymentOrders.status, ['pending', 'paid', 'refund_pending', 'partially_refunded', 'refunded'])))
      .orderBy(desc(paymentOrders.createdAt)).limit(Math.min(limit, 500));
    const issues: Array<{ orderId: string; issue: string; localValue: string; providerValue: string }> = [];
    for (const order of orders) {
      if (!order.providerOrderId || !order.providerOrderId.startsWith('cs_')) continue;
      try {
        const remote = await getPaymentProvider('stripe').retrievePayment(order.providerOrderId);
        const localPaid = ['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(order.status);
        const remotePaid = remote.paymentStatus === 'paid';
        if (localPaid !== remotePaid) {
          issues.push({ orderId: order.id, issue: 'PAYMENT_STATUS_MISMATCH', localValue: order.status, providerValue: remote.paymentStatus });
        }
        if (remote.amountTotal !== order.amountMinor || remote.currency !== order.currency) {
          issues.push({ orderId: order.id, issue: 'PAYMENT_AMOUNT_MISMATCH', localValue: `${order.amountMinor} ${order.currency}`, providerValue: `${remote.amountTotal} ${remote.currency}` });
        }
      } catch (error) {
        issues.push({ orderId: order.id, issue: 'PROVIDER_LOOKUP_FAILED', localValue: order.status, providerValue: error instanceof Error ? error.message : 'unknown' });
      }
    }
    if (issues.length) await db.insert(reconciliationItems).values(issues.map((item) => ({ runId, ...item })));
    await db.update(reconciliationRuns).set({
      status: issues.length ? 'mismatched' : 'matched',
      checkedCount: orders.length,
      mismatchCount: issues.length,
      summary: { checked: orders.length, issues: issues.length },
      completedAt: new Date(),
    }).where(eq(reconciliationRuns.id, runId));
    return { runId, checked: orders.length, issues };
  } catch (error) {
    await db.update(reconciliationRuns).set({
      status: 'failed', summary: { error: error instanceof Error ? error.message : 'unknown' }, completedAt: new Date(),
    }).where(eq(reconciliationRuns.id, runId));
    throw error;
  }
}
