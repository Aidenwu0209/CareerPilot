import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authAccounts, passwordCredentials, users } from '@/lib/db/schema';
import { config } from '@/lib/config';
import { applyRegistrationGrant } from '@/lib/credits/registration-grant';
import {
  checkRateLimit,
  getRateLimitAdapter,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';
import { userRepository } from '@/lib/db/repositories/user.repository';

const PASSWORD_PROVIDER = 'password';
const PASSWORD_VERSION = 1;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);

export function isValidPasswordInput(password: string): boolean {
  return passwordSchema.safeParse(password).success;
}

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type PasswordRegistrationResult =
  | { success: true; userId: string; onboardingRequired: true }
  | { success: false; error: 'INVALID_INPUT' | 'EMAIL_EXISTS' | 'RATE_LIMITED' };

export type PasswordLoginResult =
  | { success: true; userId: string }
  | { success: false; error: 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'ACCOUNT_SUSPENDED' | 'RATE_LIMITED' };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        cost: SCRYPT_COST,
        blockSize: SCRYPT_BLOCK_SIZE,
        parallelization: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error('INVALID_PASSWORD');

  const salt = randomBytes(16);
  const key = await deriveKey(parsed.data, salt);
  return [
    'scrypt-v1',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, expectedValue] = encoded.split('$');
  if (
    algorithm !== 'scrypt-v1'
    || Number(cost) !== SCRYPT_COST
    || Number(blockSize) !== SCRYPT_BLOCK_SIZE
    || Number(parallelization) !== SCRYPT_PARALLELIZATION
    || !saltValue
    || !expectedValue
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedValue, 'base64url');
    const actual = await deriveKey(password, Buffer.from(saltValue, 'base64url'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function usesSynchronousSQLiteTransactions(database: typeof db): boolean {
  return database.session?.constructor?.name === 'BetterSQLiteSession';
}

async function insertPasswordIdentity(input: {
  userId: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<void> {
  const user = {
    id: input.userId,
    name: input.name,
    email: input.email,
    authType: 'email' as const,
    settings: { onboardingRequired: true as const },
  };
  const account = {
    id: crypto.randomUUID(),
    userId: input.userId,
    provider: PASSWORD_PROVIDER,
    providerAccountId: input.email,
  };
  const credential = {
    id: crypto.randomUUID(),
    userId: input.userId,
    passwordHash: input.passwordHash,
    passwordVersion: PASSWORD_VERSION,
  };

  if (config.db.type === 'sqlite' || usesSynchronousSQLiteTransactions(db)) {
    db.transaction((tx: typeof db) => {
      tx.insert(users).values(user).run();
      tx.insert(authAccounts).values(account).run();
      tx.insert(passwordCredentials).values(credential).run();
    });
    return;
  }

  await db.transaction(async (tx: typeof db) => {
    await tx.insert(users).values(user);
    await tx.insert(authAccounts).values(account);
    await tx.insert(passwordCredentials).values(credential);
  });
}

async function rateLimitPasswordRequest(
  action: 'login' | 'register',
  email: string,
  ipAddress: string,
): Promise<boolean> {
  const [ipResult, emailResult] = await Promise.all([
    checkRateLimit(
      rateLimitKey(`password-${action}`, 'ip', ipAddress),
      action === 'login' ? RATE_LIMIT_POLICIES.passwordLoginIP : RATE_LIMIT_POLICIES.passwordRegisterIP,
    ),
    checkRateLimit(
      rateLimitKey(`password-${action}`, 'email', email),
      action === 'login' ? RATE_LIMIT_POLICIES.passwordLoginEmail : RATE_LIMIT_POLICIES.passwordRegisterEmail,
    ),
  ]);
  return ipResult.allowed && emailResult.allowed;
}

export async function registerPasswordAccount(
  input: { name: string; email: string; password: string },
  ipAddress: string,
): Promise<PasswordRegistrationResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'INVALID_INPUT' };

  const { name, email, password } = parsed.data;
  if (!await rateLimitPasswordRequest('register', email, ipAddress)) {
    return { success: false, error: 'RATE_LIMITED' };
  }

  if (await userRepository.findByEmail(email)) {
    return { success: false, error: 'EMAIL_EXISTS' };
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await insertPasswordIdentity({ userId, name, email, passwordHash });
  } catch (error) {
    // A concurrent registration may win after the pre-check. Never surface the
    // database error or create a partial identity.
    if (await userRepository.findByEmail(email)) {
      return { success: false, error: 'EMAIL_EXISTS' };
    }
    throw error;
  }

  try {
    await applyRegistrationGrant(userId);
  } catch {
    // Credits are non-critical and idempotent; authentication must remain usable.
  }

  return { success: true, userId, onboardingRequired: true };
}

export async function loginWithPassword(
  input: { email: string; password: string },
  ipAddress: string,
): Promise<PasswordLoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'INVALID_INPUT' };

  const { email, password } = parsed.data;
  if (!await rateLimitPasswordRequest('login', email, ipAddress)) {
    return { success: false, error: 'RATE_LIMITED' };
  }

  const user = await userRepository.findByEmail(email);
  const credentials = user
    ? await db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, user.id)).limit(1)
    : [];

  // Run scrypt even for unknown accounts so email enumeration is not exposed by
  // a materially faster response.
  const valid = credentials[0]
    ? await verifyPassword(password, credentials[0].passwordHash)
    : (await deriveKey(password, Buffer.alloc(16)), false);

  if (!user || !valid || user.status === 'deleted') {
    return { success: false, error: 'INVALID_CREDENTIALS' };
  }
  if (user.status === 'suspended') {
    return { success: false, error: 'ACCOUNT_SUSPENDED' };
  }

  const limiter = getRateLimitAdapter();
  await Promise.all([
    limiter.reset(rateLimitKey('password-login', 'ip', ipAddress)),
    limiter.reset(rateLimitKey('password-login', 'email', email)),
  ]);
  return { success: true, userId: user.id };
}
