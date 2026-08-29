import { sqliteTable, text, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './schema';

// ── Commercial entities (ToB organizations and memberships) ──

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['employer', 'school'] }).notNull().default('employer'),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  seatLimit: integer('seat_limit').notNull().default(0),
  branding: text('branding', { mode: 'json' }).notNull().default('{}'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  createdByIdx: index('organizations_created_by_idx').on(table.createdBy),
  statusIdx: index('organizations_status_idx').on(table.status),
}));

export const organizationMemberships = sqliteTable('organization_memberships', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['org_admin', 'member'] }).notNull().default('member'),
  status: text('status', { enum: ['active', 'removed'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  orgUserUnique: unique('organization_memberships_organization_id_user_id_unique').on(table.organizationId, table.userId),
  userIdx: index('organization_memberships_user_id_idx').on(table.userId),
  orgIdx: index('organization_memberships_organization_id_idx').on(table.organizationId),
  orgStatusIdx: index('organization_memberships_organization_id_status_idx').on(table.organizationId, table.status),
  userStatusIdx: index('organization_memberships_user_id_status_idx').on(table.userId, table.status),
  roleIdx: index('organization_memberships_role_idx').on(table.role),
}));

export const organizationDomains = sqliteTable('organization_domains', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  orgIdx: index('organization_domains_organization_id_idx').on(table.organizationId),
}));

export const organizationInvites = sqliteTable('organization_invites', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  codePrefix: text('code_prefix').notNull(),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  orgActiveIdx: index('organization_invites_org_active_idx').on(table.organizationId, table.active),
}));

export const organizationDiscounts = sqliteTable('organization_discounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  planCode: text('plan_code').notNull().default('*'),
  percentOff: integer('percent_off').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  startsAt: integer('starts_at', { mode: 'timestamp' }),
  endsAt: integer('ends_at', { mode: 'timestamp' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  orgPlanUnique: unique('organization_discounts_org_plan_unique').on(table.organizationId, table.planCode),
  orgActiveIdx: index('organization_discounts_org_active_idx').on(table.organizationId, table.active),
}));
