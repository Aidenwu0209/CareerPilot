import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * US-012 tests: Email OTP Authentication Backend
 *
 * Validates:
 * AC1: Email format validation, IP and email rate limiting on the request endpoint
 * AC2: Code stored as hash only, with TTL and single-use constraint
 * AC3: Valid code creates user for new email, restores same user for existing email
 * AC4: Errors, expired and used codes return stable errors without leaking registration status
 * AC5: Test mail adapter can retrieve the code in automated environments
 */

// --- Mock the DB module with an in-memory SQLite instance ---
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });

  return { db, dbReady: Promise.resolve() };
});

// --- Mock sample-resume to avoid complexity ---
vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Set NODE_ENV to test for TestMailAdapter ---
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('AUTH_SECRET', 'test-secret-with-sufficient-length-32chars!');

// --- Import AFTER mocks ---
import { requestOtp, verifyOtp, clearRateLimits } from './email-otp';
import { getMailAdapter, setMailAdapter, TestMailAdapter } from './mail-adapter';
import { db } from '@/lib/db';
import { emailOtps, users, authAccounts } from '@/lib/db/schema';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { authAccountRepository } from '@/lib/db/repositories/auth-account.repository';

beforeEach(async () => {
  // Clean tables
  await db.delete(authAccounts);
  await db.delete(emailOtps);
  await db.delete(users);

  // Reset rate limits
  clearRateLimits();

  // Reset mail adapter
  setMailAdapter(null);
  const adapter = getMailAdapter();
  if (adapter instanceof TestMailAdapter) {
    adapter.clear();
  }
});

// ── Helper: request and get the code from test adapter ──
async function requestAndGetCode(
  email: string,
  ip: string = '127.0.0.1',
): Promise<string> {
  await requestOtp(email, ip);
  const adapter = getMailAdapter();
  if (adapter instanceof TestMailAdapter) {
    const code = adapter.getLastCode(email);
    if (!code) throw new Error(`No code sent to ${email}`);
    return code;
  }
  throw new Error('TestMailAdapter not in use');
}

describe('US-012: Email OTP Authentication Backend', () => {
  // ════════════════════════════════════════════════════════
  // AC1: Email format validation, IP and email rate limiting
  // ════════════════════════════════════════════════════════
  describe('AC1: Request endpoint validation and rate limiting', () => {
    it('rejects invalid email formats', async () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user@.com',
        'user@example',
        '',
        '   ',
      ];

      for (const email of invalidEmails) {
        const result = await requestOtp(email);
        expect(result.success).toBe(false);
        expect(result.error).toBe('INVALID_EMAIL');
      }
    });

    it('accepts valid email formats', async () => {
      const validEmails = [
        'user@example.com',
        'test.user@domain.co.uk',
        'a@b.io',
        'user+tag@example.org',
      ];

      for (const email of validEmails) {
        const result = await requestOtp(email, `10.0.0.${Math.floor(Math.random() * 250)}`);
        expect(result.success).toBe(true);
        clearRateLimits();
      }
    });

    it('rate limits by IP address (max 5 per hour)', async () => {
      const ip = '192.168.1.100';

      // First 5 requests succeed
      for (let i = 0; i < 5; i++) {
        const result = await requestOtp(`user${i}@test.com`, ip);
        expect(result.success).toBe(true);
      }

      // 6th request is rate limited
      const result = await requestOtp(`user5@test.com`, ip);
      expect(result.success).toBe(false);
      expect(result.error).toBe('RATE_LIMITED');
    });

    it('rate limits by email address (max 3 per hour)', async () => {
      const email = 'sametest@test.com';
      const ips = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'];

      // First 3 requests succeed (different IPs, same email)
      for (let i = 0; i < 3; i++) {
        const result = await requestOtp(email, ips[i]);
        expect(result.success).toBe(true);
      }

      // 4th request is rate limited (different IP, same email)
      const result = await requestOtp(email, ips[3]);
      expect(result.success).toBe(false);
      expect(result.error).toBe('RATE_LIMITED');
    });

    it('does not rate limit different IPs independently', async () => {
      // Each IP gets its own bucket
      for (let i = 0; i < 6; i++) {
        const result = await requestOtp(`user${i}@test.com`, `172.16.0.${i}`);
        expect(result.success).toBe(true);
      }
    });
  });

  // ════════════════════════════════════════════════════════
  // AC2: Code stored as hash, with TTL and single-use
  // ════════════════════════════════════════════════════════
  describe('AC2: Code security — hash storage, TTL, single-use', () => {
    it('stores only SHA-256 hash, never the plaintext code', async () => {
      await requestAndGetCode('hashcheck@test.com');

      const records = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'hashcheck@test.com'));

      expect(records).toHaveLength(1);
      const record = records[0];

      // Hash should be a 64-char hex string
      expect(record.codeHash).toMatch(/^[a-f0-9]{64}$/);

      // The plaintext code should NOT appear anywhere in the record
      const testAdapter = getMailAdapter();
      if (testAdapter instanceof TestMailAdapter) {
        const plainCode = testAdapter.getLastCode('hashcheck@test.com')!;
        expect(record.codeHash).not.toBe(plainCode);
        expect(record.codeHash).not.toContain(plainCode);
        // Verify it IS the correct hash
        const crypto = await import('crypto');
        const expectedHash = crypto.createHash('sha256').update(plainCode).digest('hex');
        expect(record.codeHash).toBe(expectedHash);
      }
    });

    it('has an expiry time (10 minutes from creation)', async () => {
      await requestAndGetCode('expiry@test.com');

      const records = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'expiry@test.com'));

      const record = records[0];
      const now = Date.now();
      const expiryMs = new Date(record.expiresAt).getTime();

      // Expiry should be ~10 minutes from now (within 5 second tolerance)
      const tenMinutes = 10 * 60 * 1000;
      expect(expiryMs).toBeGreaterThan(now + tenMinutes - 5000);
      expect(expiryMs).toBeLessThan(now + tenMinutes + 5000);
    });

    it('enforces single-use — code cannot be verified twice', async () => {
      const code = await requestAndGetCode('singleuse@test.com');

      // First verification succeeds
      const result1 = await verifyOtp('singleuse@test.com', code);
      expect(result1.success).toBe(true);
      expect(result1.userId).toBeTruthy();

      // Second verification fails (code is now used)
      const result2 = await verifyOtp('singleuse@test.com', code);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('INVALID_CODE');
    });

    it('records usedAt timestamp when code is consumed', async () => {
      const code = await requestAndGetCode('usedattest@test.com');

      // Before verification, usedAt is null
      const before = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'usedattest@test.com'));
      expect(before[0].usedAt).toBeNull();

      await verifyOtp('usedattest@test.com', code);

      // After verification, usedAt is set
      const after = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'usedattest@test.com'));
      expect(after[0].usedAt).not.toBeNull();
    });

    it('increments failed attempt counter on wrong code', async () => {
      await requestAndGetCode('attempts@test.com');

      // Wrong code
      await verifyOtp('attempts@test.com', '000000');

      const records = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'attempts@test.com'));
      expect(records[0].attempts).toBe(1);
    });

    it('invalidates code after 5 failed attempts', async () => {
      const code = await requestAndGetCode('maxattempts@test.com');

      // 5 wrong attempts
      for (let i = 0; i < 5; i++) {
        const result = await verifyOtp('maxattempts@test.com', '999999');
        expect(result.success).toBe(false);
      }

      // Even with correct code, verification fails (max attempts exceeded)
      const result = await verifyOtp('maxattempts@test.com', code);
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CODE');
    });
  });

  // ════════════════════════════════════════════════════════
  // AC3: Valid code creates user for new email, restores existing user
  // ════════════════════════════════════════════════════════
  describe('AC3: User resolution — create new or restore existing', () => {
    it('creates a new user and auth account for a brand-new email', async () => {
      const code = await requestAndGetCode('brandnew@test.com');

      const result = await verifyOtp('brandnew@test.com', code);

      expect(result.success).toBe(true);
      expect(result.userId).toBeTruthy();

      // Exactly one user with this email
      const user = await userRepository.findByEmail('brandnew@test.com');
      expect(user).not.toBeNull();
      expect(user!.id).toBe(result.userId);
      expect(user!.email).toBe('brandnew@test.com');
      expect(user!.authType).toBe('email');

      // Exactly one auth account with provider='email'
      const accounts = await authAccountRepository.findByUserId(user!.id);
      const emailAccount = accounts.find((a: { provider: string }) => a.provider === 'email');
      expect(emailAccount).toBeDefined();
      expect(emailAccount!.providerAccountId).toBe('brandnew@test.com');
    });

    it('restores the same user on repeated login with existing email', async () => {
      const code1 = await requestAndGetCode('existing@test.com');
      const result1 = await verifyOtp('existing@test.com', code1);
      const originalUserId = result1.userId;

      // Request a new code and verify again
      clearRateLimits();
      const code2 = await requestAndGetCode('existing@test.com');
      const result2 = await verifyOtp('existing@test.com', code2);

      expect(result2.success).toBe(true);
      expect(result2.userId).toBe(originalUserId);

      // Still only one user
      const allUsers = await db.select().from(users).where(eq(users.email, 'existing@test.com'));
      expect(allUsers).toHaveLength(1);
    });

    it('does not create duplicate auth accounts on repeated login', async () => {
      const code1 = await requestAndGetCode('nodupes@test.com');
      await verifyOtp('nodupes@test.com', code1);

      clearRateLimits();
      const code2 = await requestAndGetCode('nodupes@test.com');
      await verifyOtp('nodupes@test.com', code2);

      const user = await userRepository.findByEmail('nodupes@test.com');
      const accounts = await authAccountRepository.findByUserId(user!.id);
      const emailAccounts = accounts.filter((a: { provider: string }) => a.provider === 'email');
      expect(emailAccounts).toHaveLength(1);
    });

    it('links email auth account to an existing user with the same email', async () => {
      // Pre-create a user (simulating an OAuth user with same email)
      const existingUserId = crypto.randomUUID();
      await db.insert(users).values({
        id: existingUserId,
        email: 'preexist@test.com',
        name: 'Pre Existing',
        authType: 'oauth',
      });

      const code = await requestAndGetCode('preexist@test.com');
      const result = await verifyOtp('preexist@test.com', code);

      expect(result.success).toBe(true);
      expect(result.userId).toBe(existingUserId);

      // Should have linked an email auth account to the existing user
      const accounts = await authAccountRepository.findByUserId(existingUserId);
      const emailAccount = accounts.find((a: { provider: string }) => a.provider === 'email');
      expect(emailAccount).toBeDefined();
    });

    it('marks a new email account for onboarding and recognizes later logins as existing', async () => {
      const code1 = await requestAndGetCode('onboarding@test.com');
      const first = await verifyOtp('onboarding@test.com', code1);
      expect(first).toMatchObject({ success: true, isNewUser: true });

      const user = await userRepository.findByEmail('onboarding@test.com');
      expect(user?.settings).toMatchObject({ onboardingRequired: true });

      clearRateLimits();
      const code2 = await requestAndGetCode('onboarding@test.com');
      const second = await verifyOtp('onboarding@test.com', code2);
      expect(second).toMatchObject({ success: true, isNewUser: false, userId: first.userId });
    });

    it('requires an explicit verified migration for a legacy fingerprint email collision', async () => {
      await db.insert(users).values({
        id: 'legacy-fingerprint-user',
        email: 'legacy@test.com',
        authType: 'fingerprint',
        fingerprint: 'legacy-browser-fingerprint',
      });
      const code = await requestAndGetCode('legacy@test.com');
      const result = await verifyOtp('legacy@test.com', code);

      expect(result).toEqual({ success: false, error: 'ACCOUNT_MIGRATION_REQUIRED' });
      expect(await authAccountRepository.findByUserId('legacy-fingerprint-user')).toHaveLength(0);
    });

    it('normalizes email to lowercase before storing', async () => {
      // Request with mixed case email
      await requestOtp('MixedCase@Test.com', '203.0.113.50');
      const adapter = getMailAdapter();
      const code = adapter instanceof TestMailAdapter
        ? adapter.getLastCode('mixedcase@test.com')
        : null;
      expect(code).not.toBeNull();

      // Verify and create user
      await verifyOtp('MixedCase@Test.com', code!);

      // User should be created with lowercase email
      const user = await userRepository.findByEmail('mixedcase@test.com');
      expect(user).not.toBeNull();

      // The stored OTP should also be lowercase
      const otpRecords = await db
        .select()
        .from(emailOtps)
        .where(eq(emailOtps.email, 'mixedcase@test.com'));
      expect(otpRecords).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════
  // AC4: Stable errors that do not leak registration status
  // ════════════════════════════════════════════════════════
  describe('AC4: Stable error responses without registration leakage', () => {
    it('returns the same error for wrong code regardless of email registration', async () => {
      // Registered email
      await requestAndGetCode('registered@test.com');

      // Unregistered email (request a code first so the error is about wrong code, not missing)
      await requestAndGetCode('unregistered@test.com');

      const result1 = await verifyOtp('registered@test.com', '000000');
      const result2 = await verifyOtp('unregistered@test.com', '000000');

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      // Both must have the same error code
      expect(result1.error).toBe(result2.error);
      expect(result1.error).toBe('INVALID_CODE');
    });

    it('returns INVALID_CODE for expired code', async () => {
      const code = await requestAndGetCode('expired@test.com');

      // Manually expire the code
      await db
        .update(emailOtps)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(emailOtps.email, 'expired@test.com'));

      const result = await verifyOtp('expired@test.com', code);
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CODE');
    });

    it('returns INVALID_CODE for already-used code', async () => {
      const code = await requestAndGetCode('reuse@test.com');

      // Use the code once
      await verifyOtp('reuse@test.com', code);

      // Try to use it again
      const result = await verifyOtp('reuse@test.com', code);
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CODE');
    });

    it('returns INVALID_CODE when no code has been requested', async () => {
      const result = await verifyOtp('neverrequested@test.com', '123456');
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CODE');
    });

    it('returns INVALID_CODE for non-existent code format', async () => {
      // Valid format but no matching hash
      await requestAndGetCode('formatok@test.com');

      const result = await verifyOtp('formatok@test.com', 'abcdef');
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CODE');
    });

    it('error response does not include user ID or PII on failure', async () => {
      await requestAndGetCode('noleak@test.com');

      const result = await verifyOtp('noleak@test.com', 'wrong');

      expect(result.success).toBe(false);
      expect(result.userId).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.name).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════
  // AC5: Test mail adapter can retrieve the code
  // ════════════════════════════════════════════════════════
  describe('AC5: Test mail adapter code retrieval', () => {
    it('TestMailAdapter stores sent emails and exposes getLastCode', async () => {
      const adapter = new TestMailAdapter();

      await adapter.sendOTP('user1@test.com', '111111');
      await adapter.sendOTP('user2@test.com', '222222');
      await adapter.sendOTP('user1@test.com', '333333');

      expect(adapter.getLastCode('user1@test.com')).toBe('333333');
      expect(adapter.getLastCode('user2@test.com')).toBe('222222');
      expect(adapter.getLastCode('unknown@test.com')).toBeNull();
    });

    it('TestMailAdapter clear() removes all stored emails', async () => {
      const adapter = new TestMailAdapter();
      await adapter.sendOTP('user@test.com', '123456');

      adapter.clear();

      expect(adapter.getLastCode('user@test.com')).toBeNull();
    });

    it('getMailAdapter returns TestMailAdapter in test environment', () => {
      const adapter = getMailAdapter();
      expect(adapter).toBeInstanceOf(TestMailAdapter);
    });

    it('OTP sent via requestOtp can be retrieved from test adapter', async () => {
      await requestOtp('adapter@test.com', '203.0.113.1');

      const adapter = getMailAdapter();
      expect(adapter).toBeInstanceOf(TestMailAdapter);

      const code = (adapter as TestMailAdapter).getLastCode('adapter@test.com');
      expect(code).not.toBeNull();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('setMailAdapter allows overriding the adapter', async () => {
      const customAdapter = new TestMailAdapter();
      setMailAdapter(customAdapter);

      expect(getMailAdapter()).toBe(customAdapter);

      await requestOtp('override@test.com', '203.0.113.2');

      expect(customAdapter.getLastCode('override@test.com')).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════
  // Full end-to-end flow
  // ════════════════════════════════════════════════════════
  describe('End-to-end OTP flow', () => {
    it('complete flow: request → verify → user created → second login restores user', async () => {
      // Step 1: Request OTP for a new email
      const code1 = await requestAndGetCode('e2e@test.com', '203.0.113.10');
      expect(code1).toMatch(/^\d{6}$/);

      // Step 2: Verify OTP
      const result1 = await verifyOtp('e2e@test.com', code1);
      expect(result1.success).toBe(true);
      expect(result1.userId).toBeTruthy();
      expect(result1.email).toBe('e2e@test.com');

      // Step 3: User exists in DB
      const user = await userRepository.findByEmail('e2e@test.com');
      expect(user).not.toBeNull();
      expect(user!.id).toBe(result1.userId);

      // Step 4: Auth account exists
      const accounts = await authAccountRepository.findByUserId(user!.id);
      expect(accounts.some((a: { provider: string }) => a.provider === 'email')).toBe(true);

      // Step 5: Second login restores same user
      clearRateLimits();
      const code2 = await requestAndGetCode('e2e@test.com', '203.0.113.11');
      const result2 = await verifyOtp('e2e@test.com', code2);
      expect(result2.success).toBe(true);
      expect(result2.userId).toBe(result1.userId);

      // Step 6: Still only one user and one email auth account
      const allUsers = await db.select().from(users).where(eq(users.email, 'e2e@test.com'));
      expect(allUsers).toHaveLength(1);
      const allAccounts = await authAccountRepository.findByUserId(user!.id);
      expect(allAccounts.filter((a: { provider: string }) => a.provider === 'email')).toHaveLength(1);
    });

    it('multiple users can register independently', async () => {
      const emails = ['multi1@test.com', 'multi2@test.com', 'multi3@test.com'];
      const userIds: string[] = [];

      for (const email of emails) {
        const code = await requestAndGetCode(email, `203.0.113.${20 + emails.indexOf(email)}`);
        const result = await verifyOtp(email, code);
        expect(result.success).toBe(true);
        expect(result.userId).toBeTruthy();
        userIds.push(result.userId!);
      }

      // All unique user IDs
      expect(new Set(userIds).size).toBe(3);

      // Each user has exactly one auth account
      for (let i = 0; i < 3; i++) {
        const accounts = await authAccountRepository.findByUserId(userIds[i]);
        expect(accounts.filter((a: { provider: string }) => a.provider === 'email')).toHaveLength(1);
      }
    });
  });
});
