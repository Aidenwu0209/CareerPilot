import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, dbReady } from '@/lib/db';
import { emailOtps, passwordCredentials } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { getMailAdapter } from './mail-adapter';
import { generateNumericCode, hashCode, isValidEmail } from './email-otp';
import { hashPassword, isValidPasswordInput } from './password-auth';
import { userRepository } from '@/lib/db/repositories/user.repository';
import {
  checkRateLimit,
  getRateLimitAdapter,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export type PasswordResetRequestResult =
  | { success: true; retryAfter: number }
  | { success: false; error: 'INVALID_EMAIL' | 'RATE_LIMITED'; retryAfter?: number };

export type PasswordResetConfirmResult =
  | { success: true }
  | { success: false; error: 'INVALID_INPUT' | 'INVALID_CODE' };

function usesSynchronousSQLiteTransactions(database: typeof db): boolean {
  return database.session?.constructor?.name === 'BetterSQLiteSession';
}

export async function requestPasswordReset(
  email: string,
  ipAddress: string,
): Promise<PasswordResetRequestResult> {
  if (!isValidEmail(email)) return { success: false, error: 'INVALID_EMAIL' };
  const normalizedEmail = email.toLowerCase().trim();
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(
      rateLimitKey('password-reset', 'ip', ipAddress),
      RATE_LIMIT_POLICIES.passwordResetIP,
    ),
    checkRateLimit(
      rateLimitKey('password-reset', 'email', normalizedEmail),
      RATE_LIMIT_POLICIES.passwordResetEmail,
    ),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return {
      success: false,
      error: 'RATE_LIMITED',
      retryAfter: Math.max(ipLimit.retryAfter, emailLimit.retryAfter),
    };
  }

  await dbReady;
  const [latest] = await db.select({ createdAt: emailOtps.createdAt }).from(emailOtps)
    .where(and(eq(emailOtps.email, normalizedEmail), eq(emailOtps.purpose, 'password_reset')))
    .orderBy(desc(emailOtps.createdAt)).limit(1);
  if (latest) {
    const remaining = Math.ceil((latest.createdAt.getTime() + COOLDOWN_MS - Date.now()) / 1_000);
    if (remaining > 0) return { success: false, error: 'RATE_LIMITED', retryAfter: remaining };
  }

  const code = generateNumericCode(CODE_LENGTH);
  const now = new Date();
  await db.update(emailOtps).set({ usedAt: now }).where(and(
    eq(emailOtps.email, normalizedEmail),
    eq(emailOtps.purpose, 'password_reset'),
    isNull(emailOtps.usedAt),
  ));
  await db.insert(emailOtps).values({
    email: normalizedEmail,
    purpose: 'password_reset',
    codeHash: hashCode(code),
    ipAddress,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });

  // The public response is identical for registered and unknown addresses.
  // Unknown addresses still receive a hashed, rate-limited record so resend
  // timing cannot be used to enumerate accounts, but no email is delivered.
  const user = await userRepository.findByEmail(normalizedEmail);
  const credentials = user
    ? await db.select({ id: passwordCredentials.id }).from(passwordCredentials)
      .where(eq(passwordCredentials.userId, user.id)).limit(1)
    : [];
  if (credentials[0]) {
    await getMailAdapter().sendOTP(normalizedEmail, code, 'password_reset');
  }
  return { success: true, retryAfter: COOLDOWN_MS / 1_000 };
}

const confirmSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string(),
});

export async function confirmPasswordReset(input: unknown): Promise<PasswordResetConfirmResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success || !isValidPasswordInput(parsed.data.password)) {
    return { success: false, error: 'INVALID_INPUT' };
  }
  const { email, code, password } = parsed.data;
  await dbReady;
  const [record] = await db.select().from(emailOtps).where(and(
    eq(emailOtps.email, email),
    eq(emailOtps.purpose, 'password_reset'),
    isNull(emailOtps.usedAt),
    gt(emailOtps.expiresAt, new Date()),
  )).orderBy(desc(emailOtps.createdAt)).limit(1);

  if (!record || record.attempts >= MAX_ATTEMPTS || hashCode(code) !== record.codeHash) {
    if (record && record.attempts < MAX_ATTEMPTS) {
      await db.update(emailOtps).set({ attempts: record.attempts + 1 })
        .where(eq(emailOtps.id, record.id));
    }
    return { success: false, error: 'INVALID_CODE' };
  }

  const user = await userRepository.findByEmail(email);
  const [credential] = user
    ? await db.select().from(passwordCredentials)
      .where(eq(passwordCredentials.userId, user.id)).limit(1)
    : [];
  if (!user || !credential) return { success: false, error: 'INVALID_CODE' };

  const passwordHash = await hashPassword(password);
  const now = new Date();
  if (config.db.type === 'sqlite' || usesSynchronousSQLiteTransactions(db)) {
    db.transaction((tx: typeof db) => {
      tx.update(passwordCredentials).set({
        passwordHash,
        passwordVersion: credential.passwordVersion + 1,
        updatedAt: now,
      }).where(eq(passwordCredentials.id, credential.id)).run();
      tx.update(emailOtps).set({ usedAt: now }).where(eq(emailOtps.id, record.id)).run();
    });
  } else {
    await db.transaction(async (tx: typeof db) => {
      await tx.update(passwordCredentials).set({
        passwordHash,
        passwordVersion: credential.passwordVersion + 1,
        updatedAt: now,
      }).where(eq(passwordCredentials.id, credential.id));
      await tx.update(emailOtps).set({ usedAt: now }).where(eq(emailOtps.id, record.id));
    });
  }

  const limiter = getRateLimitAdapter();
  await limiter.reset(rateLimitKey('password-login', 'email', email));
  await recordAuditEvent({
    actorId: user.id,
    action: 'auth.password.reset',
    targetType: 'user',
    targetId: user.id,
    result: 'success',
    summary: 'Password credential reset after email code verification',
  });
  return { success: true };
}
