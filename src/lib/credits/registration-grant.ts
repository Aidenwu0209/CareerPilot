/**
 * Registration Grant Service
 *
 * Awards the one-time registration grant to newly authenticated users.
 * The grant is idempotent — even if called multiple times for the same
 * user (e.g. duplicate OAuth callback, OTP replay, task retry), only one
 * credit transaction is ever created.
 *
 * Design goals (US-026):
 * - AC1: New users receive exactly one grant transaction based on the
 *   currently active `registration_grant` rule.
 * - AC2: Duplicate calls (OAuth callback replay, OTP replay, retry)
 *   return the original result without creating a second transaction.
 */

import { db } from '@/lib/db';
import { creditRules } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOrCreateAccount, creditAccount } from './ledger';

/** Default grant amount when no active rule exists in the database. */
const DEFAULT_GRANT_AMOUNT = 100;

/** Idempotency key namespace for registration grants. */
const grantKeyId = (userId: string) => `reg-grant-${userId}`;

export interface RegistrationGrantRule {
  id: string;
  value: number;
  version: number;
}

/**
 * Reads the currently active `registration_grant` rule.
 * Returns a default rule when none is configured.
 */
export async function getActiveGrantRule(): Promise<RegistrationGrantRule> {
  const rows = await db
    .select()
    .from(creditRules)
    .where(
      and(
        eq(creditRules.ruleType, 'registration_grant'),
        eq(creditRules.active, true),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return { id: 'default', value: DEFAULT_GRANT_AMOUNT, version: 0 };
  }

  const rule = rows[0];
  return { id: rule.id, value: rule.value, version: rule.version };
}

/**
 * Awards the one-time registration grant to a user.
 *
 * Creates a personal credit account (if it doesn't already exist) and
 * credits the grant amount. The idempotency key `reg-grant-${userId}`
 * guarantees that duplicate calls return the original result.
 *
 * This function is safe to call from both OAuth and email OTP flows,
 * and will never award the grant twice for the same user.
 *
 * @returns the transaction result, or null when the grant amount is 0.
 */
export async function applyRegistrationGrant(userId: string) {
  const rule = await getActiveGrantRule();

  // If the grant amount is configured as 0, skip creating a transaction.
  if (rule.value <= 0) return null;

  const account = await getOrCreateAccount('user', userId);

  return creditAccount({
    accountId: account.id,
    amount: rule.value,
    reason: 'registration_grant',
    idempotencyKey: grantKeyId(userId),
    ruleSnapshot: {
      ruleId: rule.id,
      ruleVersion: rule.version,
      value: rule.value,
    },
    note: 'Registration grant',
  });
}
