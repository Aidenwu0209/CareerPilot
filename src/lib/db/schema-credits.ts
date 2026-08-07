import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';

// ── Credits: accounts, transactions (immutable ledger), and rules ──

/**
 * Credit account — one per owner (user or organization).
 * Balance must never go negative (enforced by CHECK constraint in migration).
 */
export const creditAccounts = sqliteTable('credit_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerType: text('owner_type', { enum: ['user', 'organization'] }).notNull(),
  ownerId: text('owner_id').notNull(),
  balance: integer('balance').notNull().default(0),
  status: text('status', { enum: ['active', 'frozen'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  ownerUnique: unique('credit_accounts_owner_type_owner_id_unique').on(table.ownerType, table.ownerId),
  ownerTypeIdx: index('credit_accounts_owner_type_idx').on(table.ownerType),
  ownerStatusIdx: index('credit_accounts_owner_type_status_idx').on(table.ownerType, table.status),
}));

/**
 * Immutable credit transaction (ledger entry).
 * Each row records a single balance change with before/after snapshots.
 * UPDATE and DELETE are blocked by database triggers (see migration).
 */
export const creditTransactions = sqliteTable('credit_transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id').notNull().references(() => creditAccounts.id, { onDelete: 'restrict' }),
  balanceBefore: integer('balance_before').notNull(),
  delta: integer('delta').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  reason: text('reason', {
    enum: ['registration_grant', 'manual_credit', 'manual_debit', 'consumption', 'refund', 'adjustment'],
  }).notNull(),
  operatorId: text('operator_id'),
  businessRefId: text('business_ref_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  ruleSnapshot: text('rule_snapshot', { mode: 'json' }).default('{}'),
  note: text('note').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  accountIdempotencyUnique: unique('credit_transactions_account_id_idempotency_key_unique').on(table.accountId, table.idempotencyKey),
  accountIdx: index('credit_transactions_account_id_idx').on(table.accountId),
  accountCreatedIdx: index('credit_transactions_account_id_created_at_idx').on(table.accountId, table.createdAt),
  reasonIdx: index('credit_transactions_reason_idx').on(table.reason),
  businessRefIdx: index('credit_transactions_business_ref_id_idx').on(table.businessRefId),
}));

/**
 * Configurable credit rules (registration grant amount, daily limits, etc.).
 * Versioned so that rule changes only affect future events.
 */
export const creditRules = sqliteTable('credit_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ruleType: text('rule_type', {
    enum: ['registration_grant', 'daily_limit_personal', 'daily_limit_org'],
  }).notNull(),
  value: integer('value').notNull().default(0),
  version: integer('version').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  ruleTypeActiveIdx: index('credit_rules_rule_type_active_idx').on(table.ruleType, table.active),
  ruleTypeVersionIdx: index('credit_rules_rule_type_version_idx').on(table.ruleType, table.version),
}));
