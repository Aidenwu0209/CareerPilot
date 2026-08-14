import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './schema';

export const supportTickets = sqliteTable('support_tickets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category', {
    enum: ['account', 'billing', 'technical', 'career', 'other'],
  }).notNull(),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  status: text('status', {
    enum: ['open', 'in_progress', 'replied', 'closed'],
  }).notNull().default('open'),
  adminReply: text('admin_reply'),
  repliedByUserId: text('replied_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  repliedAt: integer('replied_at', { mode: 'timestamp' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => ({
  userCreatedIdx: index('support_tickets_user_id_created_at_idx').on(table.userId, table.createdAt),
  statusUpdatedIdx: index('support_tickets_status_updated_at_idx').on(table.status, table.updatedAt),
}));
