import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** Durable alert state provides deduplication across server instances. */
export const alertEvents = sqliteTable('alert_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fingerprint: text('fingerprint').notNull().unique(),
  source: text('source').notNull(),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  status: text('status', { enum: ['open', 'acknowledged', 'resolved'] }).notNull().default('open'),
  occurrenceCount: integer('occurrence_count').notNull().default(1),
  lastDeliveryStatus: text('last_delivery_status'),
  lastDeliveredAt: integer('last_delivered_at', { mode: 'timestamp' }),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
}, (table) => ({
  statusSeverityIdx: index('alert_events_status_severity_idx').on(table.status, table.severity),
  lastSeenIdx: index('alert_events_last_seen_at_idx').on(table.lastSeenAt),
}));

export const alertDeliveries = sqliteTable('alert_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  alertEventId: text('alert_event_id').notNull().references(() => alertEvents.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: ['webhook', 'email'] }).notNull(),
  destination: text('destination').notNull(),
  status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  eventIdx: index('alert_deliveries_alert_event_id_idx').on(table.alertEventId),
  channelCreatedIdx: index('alert_deliveries_channel_created_at_idx').on(table.channel, table.createdAt),
  eventChannelUnique: unique('alert_deliveries_id_channel_unique').on(table.id, table.channel),
}));
