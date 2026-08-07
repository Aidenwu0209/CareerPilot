import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';

// ── Audit events and legal consent history (both immutable) ──

/**
 * Audit event — an immutable record of a key administrative or security action.
 * Stores actor, action, target, tenant, request correlation ID, result, and a sanitized summary.
 * UPDATE and DELETE are blocked by database triggers (see migration).
 * The `summary` field must NEVER contain full API keys, Authorization headers,
 * resume text, full prompts, or plaintext credentials — only sanitized/redacted descriptions.
 */
export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorId: text('actor_id').references(() => users.id), // nullable for system-initiated events
  action: text('action').notNull(), // e.g. 'user.freeze', 'org.create', 'provider.rotate', 'credits.adjust'
  targetType: text('target_type').notNull(), // e.g. 'user', 'organization', 'provider', 'model'
  targetId: text('target_id'), // nullable: some actions target system-wide state
  tenantId: text('tenant_id'), // nullable: platform-level events have no tenant
  requestId: text('request_id'), // correlation ID for request tracing
  result: text('result', {
    enum: ['success', 'failure'],
  }).notNull().default('success'),
  summary: text('summary').notNull().default(''), // sanitized, redacted — never raw secrets
  ipAddress: text('ip_address'), // sanitized IP for traceability
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  actorIdx: index('audit_events_actor_id_idx').on(table.actorId),
  actionIdx: index('audit_events_action_idx').on(table.action),
  targetIdx: index('audit_events_target_type_target_id_idx').on(table.targetType, table.targetId),
  tenantIdx: index('audit_events_tenant_id_idx').on(table.tenantId),
  createdIdx: index('audit_events_created_at_idx').on(table.createdAt),
  actorCreatedIdx: index('audit_events_actor_id_created_at_idx').on(table.actorId, table.createdAt),
  tenantCreatedIdx: index('audit_events_tenant_id_created_at_idx').on(table.tenantId, table.createdAt),
}));

/**
 * Legal consent record — an immutable record of a user's acceptance of a legal document version.
 * Stores user, document type, version, effective date of the document, consent time, and source.
 * UPDATE and DELETE are blocked by database triggers (see migration).
 * Maintains full history: each new consent creates a new row rather than updating an existing one.
 */
export const legalConsents = sqliteTable('legal_consents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  documentType: text('document_type', {
    enum: ['privacy_policy', 'terms_of_service'],
  }).notNull(),
  version: text('version').notNull(), // e.g. '2026-01-01-v1'
  effectiveDate: integer('effective_date', { mode: 'timestamp' }).notNull(), // when the document version became effective
  source: text('source', {
    enum: ['registration', 'explicit_reconsent', 'login'],
  }).notNull(),
  ipAddress: text('ip_address'), // sanitized IP for traceability
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userIdx: index('legal_consents_user_id_idx').on(table.userId),
  userDocIdx: index('legal_consents_user_id_document_type_idx').on(table.userId, table.documentType),
  docVersionIdx: index('legal_consents_document_type_version_idx').on(table.documentType, table.version),
  createdIdx: index('legal_consents_created_at_idx').on(table.createdAt),
}));
