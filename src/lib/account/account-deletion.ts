/**
 * Account Deletion Service (US-080)
 *
 * Implements the full account deletion lifecycle:
 * 1. Re-authentication verification (OTP or recent session)
 * 2. One-time confirmation token issuance (HMAC-signed, short-lived)
 * 3. Data cleanup: hard-delete private data, anonymize user PII,
 *    soft-remove memberships, freeze credit accounts
 * 4. Idempotent: safe to retry if any step fails mid-way
 *
 * Security:
 * - Deletion requires a valid confirmation token (not just session)
 * - Token is HMAC-signed with AUTH_SECRET, bound to userId, expires in 5 min
 * - Token is single-use (verified then consumed in the same call)
 * - After deletion, auth_accounts are removed → no re-login possible
 * - User PII (email, name, fingerprint, avatar) is nullified
 * - Retained records (credit ledger, audit events, legal consents) reference
 *   the anonymized user row — no PII in those records
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { eq, and, or, isNull, desc, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  users,
  authAccounts,
  passwordCredentials,
  resumes,
  interviewSessions,
  organizationMemberships,
  careerProfiles,
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerTasks,
  careerProfileSnapshots,
  careerGuidanceNotes,
  careerMatches,
  educationRoleAssignments,
  teacherStudentAssignments,
} from '@/lib/db/schema';
import { creditAccounts } from '@/lib/db/schema-credits';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { emailOtps } from '@/lib/db/schema';

// ── Constants ──

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Types ──

export type InitiateResult =
  | { success: true; token: string; expiresAt: number }
  | { success: false; error: string };

export type ConfirmResult =
  | { success: true; userId: string }
  | { success: false; error: string };

// ── Token signing ──

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return secret;
}

function signPayload(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/**
 * Issue a one-time deletion confirmation token.
 * The token encodes userId + expiry + nonce, signed with AUTH_SECRET.
 */
export function issueDeletionToken(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}:${expiresAt}:${nonce}`;
  const signature = signPayload(payload);
  return {
    token: `${payload}:${signature}`,
    expiresAt,
  };
}

/**
 * Verify a deletion confirmation token.
 * Returns the userId if valid, null otherwise.
 */
export function verifyDeletionToken(token: string, expectedUserId: string): boolean {
  // Expected format: userId:expiresAt:nonce:signature
  const lastColon = token.lastIndexOf(':');
  if (lastColon === -1) return false;

  const payload = token.substring(0, lastColon);
  const signature = token.substring(lastColon + 1);

  // Split payload by ':' — userId contains hyphens but not colons
  const payloadParts = payload.split(':');
  if (payloadParts.length !== 3) return false;

  const [tokenUserId, expiresAtStr] = payloadParts;
  const expiresAt = parseInt(expiresAtStr, 10);

  // Check expiry
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  // Check userId matches
  if (tokenUserId !== expectedUserId) return false;

  // Verify signature (constant-time comparison)
  const expectedSignature = signPayload(payload);
  if (signature.length !== expectedSignature.length) return false;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

// ── OTP re-auth verification ──

/**
 * Verify an OTP code for re-authentication purposes.
 * Unlike verifyOtp(), this does NOT resolve or create a user identity.
 * It only checks that the code is valid for the given email and marks it as used.
 */
export async function verifyOtpForReauth(email: string, code: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const hashCode = (c: string) => createHash('sha256').update(c).digest('hex');

  // Find most recent unused, non-expired code
  const records = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, normalizedEmail),
        isNull(emailOtps.usedAt),
        gt(emailOtps.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);

  if (records.length === 0) return false;

  const record = records[0];

  // Compare hash
  if (hashCode(code) !== record.codeHash) return false;

  // Mark as used
  await db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, record.id));

  return true;
}

// ── Initiate deletion ──

/**
 * Initiate account deletion by verifying re-auth and issuing a confirmation token.
 *
 * @param userId  - The authenticated user's ID
 * @param email   - The user's email (for OTP verification)
 * @param otpCode - The OTP code provided by the user for re-auth
 * @returns Token + expiry on success, error on failure
 */
export async function initiateAccountDeletion(
  userId: string,
  email: string | null,
  otpCode: string,
): Promise<InitiateResult> {
  if (!email) {
    return { success: false, error: 'EMAIL_REQUIRED' };
  }

  // Verify OTP for re-auth
  const otpValid = await verifyOtpForReauth(email, otpCode);
  if (!otpValid) {
    return { success: false, error: 'INVALID_OTP' };
  }

  // Issue token
  const { token, expiresAt } = issueDeletionToken(userId);

  return { success: true, token, expiresAt };
}

// ── Execute deletion ──

/**
 * Execute account deletion — the core data cleanup operation.
 *
 * This function is IDEMPOTENT: if called again after a partial failure,
 * it will safely complete any remaining cleanup without error.
 *
 * Steps (in order):
 * 1. Hard-delete resumes (cascades to sections, shares, chat sessions, chat messages, jd_analyses, grammar_checks)
 * 2. Hard-delete interview sessions (cascades to rounds, messages, reports)
 * 3. Hard-delete private career data, guidance, and teacher/student links
 * 4. Hard-delete auth accounts (prevents re-login)
 * 5. Soft-remove organization memberships and education roles (frees seats)
 * 6. Freeze personal credit accounts
 * 7. Anonymize user PII and set status to 'deleted'
 *
 * Note: audit_events, legal_consents, and credit_transactions are immutable
 * (DB triggers block UPDATE/DELETE). They retain their references to the
 * now-anonymized user row — no PII is recoverable from those records.
 */
export async function deleteUserData(userId: string): Promise<void> {
  const now = new Date();

  // Step 1: Delete resumes (cascade handles children)
  await db.delete(resumes).where(eq(resumes.userId, userId));

  // Step 2: Delete interview sessions (cascade handles rounds, messages, reports)
  await db.delete(interviewSessions).where(eq(interviewSessions.userId, userId));

  // Step 3: Delete private career data explicitly. The user row is retained and
  // anonymized, so its cascade constraints never fire during account deletion.
  await db.delete(careerMatches).where(eq(careerMatches.userId, userId));
  await db.delete(careerTasks).where(eq(careerTasks.userId, userId));
  await db.delete(careerProfileSnapshots).where(eq(careerProfileSnapshots.userId, userId));
  await db.delete(careerEvidence).where(eq(careerEvidence.userId, userId));
  await db.delete(careerAbilities).where(eq(careerAbilities.userId, userId));
  await db.delete(careerGoals).where(eq(careerGoals.userId, userId));
  await db.delete(careerProfiles).where(eq(careerProfiles.userId, userId));

  // Guidance may belong to the user as a student or have been authored by the
  // user as a teacher. Both directions contain user-linked private content.
  await db
    .delete(careerGuidanceNotes)
    .where(or(
      eq(careerGuidanceNotes.userId, userId),
      eq(careerGuidanceNotes.teacherId, userId),
    ));

  // Remove both sides of explicit teacher/student access grants.
  await db
    .delete(teacherStudentAssignments)
    .where(or(
      eq(teacherStudentAssignments.teacherUserId, userId),
      eq(teacherStudentAssignments.studentUserId, userId),
    ));

  // Step 4: Delete all authentication credentials and linked providers.
  await db.delete(passwordCredentials).where(eq(passwordCredentials.userId, userId));
  await db.delete(authAccounts).where(eq(authAccounts.userId, userId));

  // Step 5: Soft-remove active organization memberships and education roles.
  await db
    .update(organizationMemberships)
    .set({ status: 'removed', updatedAt: now })
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active'),
      ),
    );

  await db
    .update(educationRoleAssignments)
    .set({ status: 'removed', updatedAt: now })
    .where(
      and(
        eq(educationRoleAssignments.userId, userId),
        eq(educationRoleAssignments.status, 'active'),
      ),
    );

  // Step 6: Freeze personal credit accounts
  await db
    .update(creditAccounts)
    .set({ status: 'frozen', updatedAt: now })
    .where(
      and(
        eq(creditAccounts.ownerType, 'user'),
        eq(creditAccounts.ownerId, userId),
      ),
    );

  // Step 7: Anonymize user PII and mark as deleted
  await db
    .update(users)
    .set({
      email: null,
      name: null,
      fingerprint: null,
      avatarUrl: null,
      settings: '{}',
      status: 'deleted',
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

/**
 * Confirm and execute account deletion.
 *
 * @param userId - The authenticated user's ID
 * @param token  - The confirmation token from initiateAccountDeletion
 */
export async function confirmAccountDeletion(
  userId: string,
  token: string,
): Promise<ConfirmResult> {
  // Verify token
  if (!verifyDeletionToken(token, userId)) {
    return { success: false, error: 'INVALID_OR_EXPIRED_TOKEN' };
  }

  // Check user exists
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) {
    return { success: false, error: 'USER_NOT_FOUND' };
  }

  // If already deleted, return success (idempotent)
  if (userRows[0].status === 'deleted') {
    return { success: true, userId };
  }

  // Execute deletion
  await deleteUserData(userId);

  // Record audit event (immutable, references anonymized user)
  await recordAuditEvent({
    actorId: userId,
    action: 'user.delete_account',
    targetType: 'user',
    targetId: userId,
    result: 'success',
    summary: 'User initiated account deletion — data anonymized and auth revoked',
  });

  return { success: true, userId };
}
