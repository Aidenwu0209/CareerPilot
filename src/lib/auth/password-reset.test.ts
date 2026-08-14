import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('node:path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

vi.mock('@/lib/config', () => ({ config: { db: { type: 'sqlite' as const } } }));
vi.mock('@/lib/credits/registration-grant', () => ({ applyRegistrationGrant: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/audit/audit-service', () => ({ recordAuditEvent: vi.fn().mockResolvedValue('audit-id') }));
vi.stubEnv('NODE_ENV', 'test');

import { db } from '@/lib/db';
import { authAccounts, emailOtps, passwordCredentials, users } from '@/lib/db/schema';
import { clearRateLimits } from '@/lib/rate-limit/rate-limit';
import { getMailAdapter, setMailAdapter, TestMailAdapter } from './mail-adapter';
import { requestOtp, verifyOtp } from './email-otp';
import { loginWithPassword, registerPasswordAccount } from './password-auth';
import { confirmPasswordReset, requestPasswordReset } from './password-reset';

const oldPassword = 'Career2026Old';
const newPassword = 'Career2026New';

beforeEach(async () => {
  await db.delete(emailOtps);
  await db.delete(passwordCredentials);
  await db.delete(authAccounts);
  await db.delete(users);
  await clearRateLimits();
  setMailAdapter(null);
  const mailer = getMailAdapter();
  if (mailer instanceof TestMailAdapter) mailer.clear();
});

async function register(email: string) {
  const result = await registerPasswordAccount({ name: 'Reset User', email, password: oldPassword }, '203.0.113.1');
  expect(result.success).toBe(true);
}

function lastCode(email: string) {
  const mailer = getMailAdapter();
  return mailer instanceof TestMailAdapter ? mailer.getLastCode(email) : null;
}

describe('password reset', () => {
  it('changes the password only after a valid, single-use reset code', async () => {
    const email = 'reset@example.com';
    await register(email);
    await expect(requestPasswordReset(email, '203.0.113.2')).resolves.toMatchObject({ success: true, retryAfter: 60 });
    const code = lastCode(email);
    expect(code).toMatch(/^\d{6}$/);

    await expect(confirmPasswordReset({ email, code, password: newPassword })).resolves.toEqual({ success: true });
    await expect(loginWithPassword({ email, password: oldPassword }, '203.0.113.3'))
      .resolves.toEqual({ success: false, error: 'INVALID_CREDENTIALS' });
    await expect(loginWithPassword({ email, password: newPassword }, '203.0.113.4'))
      .resolves.toMatchObject({ success: true });
    await expect(confirmPasswordReset({ email, code, password: 'Career2026Again' }))
      .resolves.toEqual({ success: false, error: 'INVALID_CODE' });
  });

  it('does not reveal whether an email has a password account', async () => {
    const unknown = 'unknown-reset@example.com';
    await expect(requestPasswordReset(unknown, '203.0.113.5')).resolves.toMatchObject({ success: true, retryAfter: 60 });
    expect(lastCode(unknown)).toBeNull();
    const [record] = await db.select().from(emailOtps);
    expect(record).toMatchObject({ email: unknown, purpose: 'password_reset' });
    expect(record.codeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('enforces the resend cooldown and the five-attempt limit', async () => {
    const email = 'attempt-reset@example.com';
    await register(email);
    await requestPasswordReset(email, '203.0.113.6');
    const code = lastCode(email)!;
    await expect(requestPasswordReset(email, '203.0.113.7')).resolves.toMatchObject({ success: false, error: 'RATE_LIMITED' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(confirmPasswordReset({ email, code: '000000', password: newPassword }))
        .resolves.toEqual({ success: false, error: 'INVALID_CODE' });
    }
    await expect(confirmPasswordReset({ email, code, password: newPassword }))
      .resolves.toEqual({ success: false, error: 'INVALID_CODE' });
  });

  it('keeps login codes and password-reset codes isolated by purpose', async () => {
    const email = 'purpose-reset@example.com';
    await register(email);
    await requestOtp(email, '203.0.113.8');
    const loginCode = lastCode(email)!;
    await requestPasswordReset(email, '203.0.113.8');
    const resetCode = lastCode(email)!;
    const rows = await db.select().from(emailOtps);
    expect(rows.map((row: { purpose: string }) => row.purpose).sort()).toEqual(['login', 'password_reset']);
    await expect(verifyOtp(email, resetCode)).resolves.toEqual({ success: false, error: 'INVALID_CODE' });
    await expect(confirmPasswordReset({ email, code: loginCode, password: newPassword }))
      .resolves.toEqual({ success: false, error: 'INVALID_CODE' });
  });
});
