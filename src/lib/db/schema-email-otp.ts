import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Email OTP (one-time password) storage table.
 *
 * Security design:
 * - `codeHash` stores a SHA-256 digest of the numeric code, never the plaintext code.
 * - `expiresAt` enforces a TTL (10 minutes default).
 * - `usedAt` is null until the code is consumed; non-null means single-use fulfilled.
 * - `attempts` tracks failed verification attempts per code (max 5).
 */
export const emailOtps = sqliteTable(
  'email_otps',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    email: text('email').notNull(),
    purpose: text('purpose', { enum: ['login', 'password_reset', 'school_verify'] }).notNull().default('login'),
    codeHash: text('code_hash').notNull(),
    ipAddress: text('ip_address'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index('email_otps_email_idx').on(table.email),
    emailUsedIdx: index('email_otps_email_used_at_idx').on(table.email, table.usedAt),
    emailPurposeCreatedIdx: index('email_otps_email_purpose_created_at_idx').on(table.email, table.purpose, table.createdAt),
    ipIdx: index('email_otps_ip_address_idx').on(table.ipAddress),
  }),
);
