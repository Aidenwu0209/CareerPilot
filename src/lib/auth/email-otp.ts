/**
 * Email OTP (one-time password) authentication service.
 *
 * Implements:
 * - Code generation (cryptographic random 6-digit)
 * - Code hashing (SHA-256 — only digest stored)
 * - Rate limiting via shared rate-limit module (IP and email dimensions)
 * - Verification with single-use and expiry enforcement
 * - User resolution (create new or link existing user + auth account)
 */

import { createHash, randomBytes } from 'crypto';
import { eq, and, isNull, gt, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { emailOtps } from '@/lib/db/schema';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { authAccountRepository } from '@/lib/db/repositories/auth-account.repository';
import { applyRegistrationGrant } from '@/lib/credits/registration-grant';
import { getMailAdapter } from './mail-adapter';
import {
  checkRateLimit,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';
import {
  assertRealAccountCanLink,
  FingerprintAccountMigrationRequiredError,
} from './onboarding';
import { createAuthIdentity } from './account-creation';

// ── Constants ──

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5; // Max failed verification attempts per code

export const EMAIL_PROVIDER = 'email';

/** Clear all rate limit data (for testing). */
export { clearRateLimits } from '@/lib/rate-limit/rate-limit';

// ── Code generation & hashing ──

/** Generate a cryptographically random numeric code. */
export function generateNumericCode(length: number): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += (bytes[i] % 10).toString();
  }
  return code;
}

/** Hash a code using SHA-256. Only the digest is stored. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ── Email validation ──

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

// ── Public API ──

export interface OtpRequestResult {
  success: boolean;
  error?: 'INVALID_EMAIL' | 'RATE_LIMITED';
}

export interface OtpVerifyResult {
  success: boolean;
  error?: 'INVALID_CODE' | 'RATE_LIMITED' | 'ACCOUNT_MIGRATION_REQUIRED';
  userId?: string;
  email?: string;
  name?: string | null;
  isNewUser?: boolean;
}

/**
 * Generate and send an OTP to the given email.
 *
 * - Validates email format
 * - Enforces IP and email rate limits
 * - Generates a cryptographic 6-digit code
 * - Stores only the SHA-256 hash in the database
 * - Sends the plaintext code via the mail adapter
 */
export async function requestOtp(
  email: string,
  ipAddress?: string | null,
): Promise<OtpRequestResult> {
  // Validate email format
  if (!isValidEmail(email)) {
    return { success: false, error: 'INVALID_EMAIL' };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Rate limit by IP (uses shared rate-limit module for cross-instance counting)
  if (ipAddress) {
    const ipResult = await checkRateLimit(
      rateLimitKey('otp', 'ip', ipAddress),
      RATE_LIMIT_POLICIES.otpRequestIP,
    );
    if (!ipResult.allowed) {
      return { success: false, error: 'RATE_LIMITED' };
    }
  }

  // Rate limit by email
  const emailResult = await checkRateLimit(
    rateLimitKey('otp', 'email', normalizedEmail),
    RATE_LIMIT_POLICIES.otpRequestEmail,
  );
  if (!emailResult.allowed) {
    return { success: false, error: 'RATE_LIMITED' };
  }

  // Generate code
  const code = generateNumericCode(CODE_LENGTH);
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  // Store hash (never the plaintext code)
  await db.insert(emailOtps).values({
    email: normalizedEmail,
    purpose: 'login',
    codeHash,
    ipAddress: ipAddress || null,
    expiresAt,
  });

  // Send email via adapter
  const mailer = getMailAdapter();
  await mailer.sendOTP(normalizedEmail, code, 'login');

  return { success: true };
}

/**
 * Verify an OTP code and resolve the user identity.
 *
 * - Looks up the most recent unused, non-expired code for the email
 * - Compares the hash (never stores or compares plaintext)
 * - Enforces single-use (marks as used on success)
 * - Increments failed attempt counter on mismatch (max 5)
 * - Resolves or creates the user identity on success
 *
 * Returns a stable error for all failure modes (does not leak
 * whether the email is registered).
 */
export async function verifyOtp(
  email: string,
  code: string,
): Promise<OtpVerifyResult> {
  const normalizedEmail = email.toLowerCase().trim();

  // Find most recent unused, non-expired code
  const records = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, normalizedEmail),
        eq(emailOtps.purpose, 'login'),
        isNull(emailOtps.usedAt),
        gt(emailOtps.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);

  if (records.length === 0) {
    return { success: false, error: 'INVALID_CODE' };
  }

  const record = records[0];

  // Check attempt limit
  if (record.attempts >= MAX_ATTEMPTS) {
    return { success: false, error: 'INVALID_CODE' };
  }

  // Compare hash
  const inputHash = hashCode(code);
  if (inputHash !== record.codeHash) {
    // Increment attempt counter
    await db
      .update(emailOtps)
      .set({ attempts: record.attempts + 1 })
      .where(eq(emailOtps.id, record.id));

    return { success: false, error: 'INVALID_CODE' };
  }

  // Mark as used (single-use enforcement)
  await db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, record.id));

  // Resolve user identity
  let result: EmailAccountResult;
  try {
    result = await resolveEmailAccount(normalizedEmail);
  } catch (error) {
    if (error instanceof FingerprintAccountMigrationRequiredError) {
      return { success: false, error: 'ACCOUNT_MIGRATION_REQUIRED' };
    }
    throw error;
  }

  return {
    success: true,
    userId: result.userId,
    email: normalizedEmail,
    name: result.name,
    isNewUser: result.isNewUser,
  };
}

// ── User resolution ──

export interface EmailAccountResult {
  userId: string;
  name: string | null;
  isNewUser: boolean;
}

/**
 * Resolve or create a user identity for email-based auth.
 *
 * Resolution order:
 * 1. Existing user with same email → link email auth account (if not already linked)
 * 2. No user → create new user + auth account atomically
 */
async function resolveEmailAccount(email: string): Promise<EmailAccountResult> {
  // Step 1: Check for existing user with this email
  const existingUser = await userRepository.findByEmail(email);

  if (existingUser) {
    assertRealAccountCanLink(existingUser);
    // Check if email auth account already exists
    const existingAccount = await authAccountRepository.findByProviderAndAccountId(
      EMAIL_PROVIDER,
      email,
    );

    if (!existingAccount) {
      await authAccountRepository.create({
        userId: existingUser.id,
        provider: EMAIL_PROVIDER,
        providerAccountId: email,
      });
    }

    return {
      userId: existingUser.id,
      name: existingUser.name,
      isNewUser: false,
    };
  }

  // Step 2: Create new user + auth account atomically on either DB adapter.
  const newUserId = crypto.randomUUID();
  await createAuthIdentity({
    user: {
      id: newUserId,
      email,
      authType: 'email',
      settings: { onboardingRequired: true },
    },
    account: {
      id: crypto.randomUUID(),
      userId: newUserId,
      provider: EMAIL_PROVIDER,
      providerAccountId: email,
    },
  });

  // Apply one-time registration grant (idempotent — safe even on replay)
  try {
    await applyRegistrationGrant(newUserId);
  } catch {
    // Grant failure should not block authentication
  }

  return {
    userId: newUserId,
    name: null,
    isNewUser: true,
  };
}
