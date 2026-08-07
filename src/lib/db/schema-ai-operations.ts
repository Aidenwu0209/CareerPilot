import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';
import { creditAccounts } from './schema-credits';
import { aiModels } from './schema-ai-providers';

// ── AI operations, provider attempts, and credit holds ──

/**
 * AI operation — a single business-level AI request (e.g. resume optimization, cover letter).
 * Tracks the actor, billing account, capability, status, and idempotency.
 * One operation may have multiple provider attempts (retries, multi-step calls).
 */
export const aiOperations = sqliteTable('ai_operations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text('actor_id').notNull().references(() => users.id),
  billingAccountId: text('billing_account_id').notNull().references(() => creditAccounts.id),
  capability: text('capability').notNull(), // e.g. 'resume_optimize', 'cover_letter', 'chat', 'interview', 'photo'
  status: text('status', {
    enum: ['pending', 'in_progress', 'succeeded', 'failed', 'cancelled'],
  }).notNull().default('pending'),
  idempotencyKey: text('idempotency_key').notNull(),
  finalSettlementId: text('final_settlement_id'), // FK to credit_transactions, set after settlement
  metadata: text('metadata', { mode: 'json' }).default('{}'), // non-sensitive business context only
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  idempotencyUnique: unique('ai_operations_idempotency_key_unique').on(table.idempotencyKey),
  actorIdx: index('ai_operations_actor_id_idx').on(table.actorId),
  billingAccountIdx: index('ai_operations_billing_account_id_idx').on(table.billingAccountId),
  capabilityIdx: index('ai_operations_capability_idx').on(table.capability),
  statusIdx: index('ai_operations_status_idx').on(table.status),
  actorCapabilityIdx: index('ai_operations_actor_id_capability_idx').on(table.actorId, table.capability),
  createdIdx: index('ai_operations_created_at_idx').on(table.createdAt),
}));

/**
 * Provider attempt — a single real upstream API call within an operation.
 * Each retry or multi-step call creates a new attempt with an incrementing sequence number.
 * The `usage` field stores token counts and cost metrics — never sensitive data like
 * prompts, resume text, or plaintext credentials.
 */
export const aiProviderAttempts = sqliteTable('ai_provider_attempts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  operationId: text('operation_id').notNull().references(() => aiOperations.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull().references(() => aiModels.id),
  attemptNumber: integer('attempt_number').notNull(),
  status: text('status', {
    enum: ['pending', 'in_progress', 'succeeded', 'failed', 'timeout'],
  }).notNull().default('pending'),
  usage: text('usage', { mode: 'json' }).default('{}'), // non-sensitive: {inputTokens, outputTokens, totalTokens, etc.}
  providerRequestId: text('provider_request_id'), // upstream provider's request ID for traceability
  errorMessage: text('error_message'), // sanitized error, no sensitive data
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  operationAttemptUnique: unique('ai_provider_attempts_operation_id_attempt_number_unique').on(table.operationId, table.attemptNumber),
  operationIdx: index('ai_provider_attempts_operation_id_idx').on(table.operationId),
  modelIdx: index('ai_provider_attempts_model_id_idx').on(table.modelId),
  statusIdx: index('ai_provider_attempts_status_idx').on(table.status),
}));

/**
 * Credit hold — a pre-reserved amount on an account for an ongoing AI operation.
 * Created before the provider call, settled or released after completion.
 * `holdAmount` and `settledAmount` must both be non-negative (enforced by CHECK in migration).
 */
export const creditHolds = sqliteTable('credit_holds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
  operationId: text('operation_id').notNull().references(() => aiOperations.id, { onDelete: 'cascade' }),
  holdAmount: integer('hold_amount').notNull(),
  settledAmount: integer('settled_amount').notNull().default(0),
  status: text('status', {
    enum: ['active', 'settled', 'released', 'expired'],
  }).notNull().default('active'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  settledAt: integer('settled_at', { mode: 'timestamp' }),
}, (table) => ({
  accountIdx: index('credit_holds_account_id_idx').on(table.accountId),
  operationIdx: index('credit_holds_operation_id_idx').on(table.operationId),
  statusIdx: index('credit_holds_status_idx').on(table.status),
  expiresIdx: index('credit_holds_expires_at_idx').on(table.expiresAt),
  accountStatusIdx: index('credit_holds_account_id_status_idx').on(table.accountId, table.status),
}));
