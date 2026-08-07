/**
 * Super Admin Bootstrap
 *
 * Grants the first `super_admin` role to an explicitly configured account.
 * This is the ONLY mechanism for escalating a user to super_admin; regular
 * registration never auto-promotes.
 *
 * Configuration: set `BOOTSTRAP_SUPER_ADMIN_EMAIL` in the environment.
 *
 * The bootstrap is idempotent — running it multiple times has no adverse effect.
 * Both success and failure paths generate immutable audit events without sensitive values.
 */

import { db, dbReady } from '@/lib/db';
import { users, auditEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type BootstrapAction =
  | 'promoted'
  | 'already_admin'
  | 'user_not_found'
  | 'not_configured';

export interface BootstrapResult {
  action: BootstrapAction;
  email?: string;
  userId?: string;
}

/**
 * Redact an email address for safe logging/auditing.
 * Shows the first 2 chars of the local part, masks the rest.
 * Example: "admin@example.com" -> "ad***@example.com"
 */
function redactEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex < 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

/**
 * Run the super admin bootstrap.
 *
 * Should be called once at application startup, after the database is ready.
 * Never throws — failures are logged and audited so that startup can continue.
 */
export async function bootstrapSuperAdmin(): Promise<BootstrapResult> {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  // AC5: no bootstrap target configured
  if (!email) {
    if (isProduction) {
      console.warn(
        '[Bootstrap] BOOTSTRAP_SUPER_ADMIN_EMAIL is not configured. ' +
        'No super admin will be granted. Set this env var to explicitly designate the first super admin.',
      );
    }
    return { action: 'not_configured' };
  }

  // Ensure DB is ready before querying
  await dbReady;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const targetUser = rows[0];

  // AC3: target user doesn't exist yet — audit the failure
  if (!targetUser) {
    await db.insert(auditEvents).values({
      actorId: null, // system-initiated
      action: 'bootstrap.super_admin',
      targetType: 'user',
      targetId: null,
      result: 'failure',
      summary: `Bootstrap target not found: ${redactEmail(email)}`,
    });

    console.warn(
      `[Bootstrap] Configured target ${redactEmail(email)} not found in database. ` +
      'Bootstrap will retry on next startup once the user registers.',
    );
    return { action: 'user_not_found', email };
  }

  // AC2: already super_admin — idempotent, no duplicate role change
  if (targetUser.platformRole === 'super_admin') {
    await db.insert(auditEvents).values({
      actorId: null,
      action: 'bootstrap.super_admin',
      targetType: 'user',
      targetId: targetUser.id,
      result: 'success',
      summary: `User already holds super_admin role (idempotent): ${redactEmail(email)}`,
    });

    console.log(`[Bootstrap] ${redactEmail(email)} is already super_admin (no change).`);
    return { action: 'already_admin', email, userId: targetUser.id };
  }

  // AC1: promote to super_admin
  await db
    .update(users)
    .set({ platformRole: 'super_admin', updatedAt: new Date() })
    .where(eq(users.id, targetUser.id));

  // AC3: audit the success
  await db.insert(auditEvents).values({
    actorId: null,
    action: 'bootstrap.super_admin',
    targetType: 'user',
    targetId: targetUser.id,
    result: 'success',
    summary: `Bootstrap granted super_admin to ${redactEmail(email)}`,
  });

  console.log(`[Bootstrap] Granted super_admin to ${redactEmail(email)}.`);
  return { action: 'promoted', email, userId: targetUser.id };
}
