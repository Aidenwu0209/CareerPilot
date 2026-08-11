import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';
import { creditAccounts } from './schema-credits';
import { aiModels } from './schema-ai-providers';

/** Sellable credit packs and recurring subscriptions. Money is stored in minor units. */
export const billingPlans = sqliteTable('billing_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind', { enum: ['credit_pack', 'subscription'] }).notNull(),
  userLevel: text('user_level').notNull().default('free'),
  priceMinor: integer('price_minor').notNull(),
  currency: text('currency').notNull().default('cny'),
  credits: integer('credits').notNull(),
  billingInterval: text('billing_interval', { enum: ['month', 'year'] }),
  stripePriceId: text('stripe_price_id').unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  kindActiveIdx: index('billing_plans_kind_active_idx').on(table.kind, table.active),
  levelIdx: index('billing_plans_user_level_idx').on(table.userLevel),
}));

/** Explicit model allow-list for each plan/level. */
export const planModelAccess = sqliteTable('plan_model_access', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => aiModels.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  planModelUnique: unique('plan_model_access_plan_id_model_id_unique').on(table.planId, table.modelId),
  planIdx: index('plan_model_access_plan_id_idx').on(table.planId),
  modelIdx: index('plan_model_access_model_id_idx').on(table.modelId),
}));

/** Current and historical user subscription entitlements. */
export const userEntitlements = sqliteTable('user_entitlements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'restrict' }),
  status: text('status', { enum: ['active', 'past_due', 'canceled', 'expired'] }).notNull().default('active'),
  provider: text('provider').notNull().default('stripe'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id').unique(),
  currentPeriodStart: integer('current_period_start', { mode: 'timestamp' }),
  currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userStatusIdx: index('user_entitlements_user_id_status_idx').on(table.userId, table.status),
  periodEndIdx: index('user_entitlements_period_end_idx').on(table.currentPeriodEnd),
}));

export const paymentOrders = sqliteTable('payment_orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => billingPlans.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull().default('stripe'),
  providerOrderId: text('provider_order_id').unique(),
  providerPaymentId: text('provider_payment_id'),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  status: text('status', { enum: ['pending', 'paid', 'refund_pending', 'partially_refunded', 'refunded', 'failed', 'canceled'] }).notNull().default('pending'),
  amountMinor: integer('amount_minor').notNull(),
  paidMinor: integer('paid_minor').notNull().default(0),
  refundedMinor: integer('refunded_minor').notNull().default(0),
  currency: text('currency').notNull(),
  credits: integer('credits').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),
  paidAt: integer('paid_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userCreatedIdx: index('payment_orders_user_id_created_at_idx').on(table.userId, table.createdAt),
  statusIdx: index('payment_orders_status_idx').on(table.status),
  providerPaymentIdx: index('payment_orders_provider_payment_id_idx').on(table.providerPaymentId),
  providerSubscriptionIdx: index('payment_orders_provider_subscription_id_idx').on(table.providerSubscriptionId),
}));

export const paymentRefunds = sqliteTable('payment_refunds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text('order_id').notNull().references(() => paymentOrders.id, { onDelete: 'restrict' }),
  providerRefundId: text('provider_refund_id').unique(),
  status: text('status', { enum: ['pending', 'succeeded', 'failed', 'canceled'] }).notNull().default('pending'),
  amountMinor: integer('amount_minor').notNull(),
  creditsReversed: integer('credits_reversed').notNull(),
  reason: text('reason').notNull().default('customer_request'),
  requestedBy: text('requested_by').references(() => users.id),
  failureReason: text('failure_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  orderIdx: index('payment_refunds_order_id_idx').on(table.orderId),
  statusIdx: index('payment_refunds_status_idx').on(table.status),
}));

/** Persisted event IDs make webhook processing exactly-once. */
export const paymentWebhookEvents = sqliteTable('payment_webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  status: text('status', { enum: ['processing', 'processed', 'failed', 'ignored'] }).notNull().default('processing'),
  payloadHash: text('payload_hash').notNull(),
  errorMessage: text('error_message'),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  providerEventUnique: unique('payment_webhook_events_provider_event_id_unique').on(table.provider, table.eventId),
  statusCreatedIdx: index('payment_webhook_events_status_created_at_idx').on(table.status, table.createdAt),
}));

export const reconciliationRuns = sqliteTable('reconciliation_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  status: text('status', { enum: ['running', 'matched', 'mismatched', 'failed'] }).notNull().default('running'),
  checkedCount: integer('checked_count').notNull().default(0),
  mismatchCount: integer('mismatch_count').notNull().default(0),
  startedBy: text('started_by'),
  summary: text('summary', { mode: 'json' }).notNull().default('{}'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  providerStartedIdx: index('reconciliation_runs_provider_started_at_idx').on(table.provider, table.startedAt),
}));

export const reconciliationItems = sqliteTable('reconciliation_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => reconciliationRuns.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => paymentOrders.id, { onDelete: 'set null' }),
  issue: text('issue').notNull(),
  localValue: text('local_value'),
  providerValue: text('provider_value'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  runIdx: index('reconciliation_items_run_id_idx').on(table.runId),
  orderIdx: index('reconciliation_items_order_id_idx').on(table.orderId),
}));
