import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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

vi.mock('@/lib/config', () => ({
  config: { db: { type: 'sqlite' as const } },
}));

vi.mock('@/lib/credits/registration-grant', () => ({
  applyRegistrationGrant: vi.fn().mockResolvedValue(null),
}));

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('AUTH_SECRET', 'password-auth-test-secret-at-least-32-chars');

import { db } from '@/lib/db';
import { authAccounts, passwordCredentials, users } from '@/lib/db/schema';
import { clearRateLimits } from '@/lib/rate-limit/rate-limit';
import {
  hashPassword,
  loginWithPassword,
  registerPasswordAccount,
  verifyPassword,
} from './password-auth';
import { POST as registerRoute } from '@/app/api/auth/password/register/route';
import { POST as loginRoute } from '@/app/api/auth/password/login/route';

const validPassword = 'Career2026Secure';

function request(url: string, body: unknown, ip = '203.0.113.20') {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await db.delete(passwordCredentials);
  await db.delete(authAccounts);
  await db.delete(users);
  await clearRateLimits();
});

describe('password authentication', () => {
  it('stores a salted scrypt hash and never stores the plaintext password', async () => {
    const first = await hashPassword(validPassword);
    const second = await hashPassword(validPassword);

    expect(first).toMatch(/^scrypt-v1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(validPassword);
    await expect(verifyPassword(validPassword, first)).resolves.toBe(true);
    await expect(verifyPassword('Wrong2026Password', first)).resolves.toBe(false);
  });

  it('registers user, account link, and password credential atomically', async () => {
    const result = await registerPasswordAccount({
      name: '林同学',
      email: 'STUDENT@example.com',
      password: validPassword,
    }, '203.0.113.21');

    expect(result).toMatchObject({ success: true, onboardingRequired: true });
    const [user] = await db.select().from(users).where(eq(users.email, 'student@example.com'));
    const [account] = await db.select().from(authAccounts).where(eq(authAccounts.userId, user.id));
    const [credential] = await db.select().from(passwordCredentials).where(eq(passwordCredentials.userId, user.id));
    expect(user).toMatchObject({ name: '林同学', authType: 'email', settings: { onboardingRequired: true } });
    expect(account).toMatchObject({ provider: 'password', providerAccountId: 'student@example.com' });
    expect(credential.passwordHash).not.toContain(validPassword);
  });

  it('keeps registration and login separate and rejects duplicate email registration', async () => {
    const first = await registerPasswordAccount({ name: '学生甲', email: 'same@example.com', password: validPassword }, '203.0.113.22');
    const duplicate = await registerPasswordAccount({ name: '学生乙', email: 'same@example.com', password: 'Another2026Password' }, '203.0.113.23');

    expect(first.success).toBe(true);
    expect(duplicate).toEqual({ success: false, error: 'EMAIL_EXISTS' });
    expect(await db.select().from(users).where(eq(users.email, 'same@example.com'))).toHaveLength(1);
  });

  it('returns one generic error for an unknown email and a wrong password', async () => {
    await registerPasswordAccount({ name: '林同学', email: 'login@example.com', password: validPassword }, '203.0.113.24');

    await expect(loginWithPassword({ email: 'missing@example.com', password: validPassword }, '203.0.113.25'))
      .resolves.toEqual({ success: false, error: 'INVALID_CREDENTIALS' });
    await expect(loginWithPassword({ email: 'login@example.com', password: 'Wrong2026Password' }, '203.0.113.26'))
      .resolves.toEqual({ success: false, error: 'INVALID_CREDENTIALS' });
    await expect(loginWithPassword({ email: 'login@example.com', password: validPassword }, '203.0.113.27'))
      .resolves.toMatchObject({ success: true });
  });

  it('creates a signed session cookie through register and login routes', async () => {
    const registration = await registerRoute(request('/api/auth/password/register', {
      name: '周同学',
      email: 'route@example.com',
      password: validPassword,
    }, '203.0.113.28'));
    expect(registration.status).toBe(201);
    expect(registration.headers.get('set-cookie')).toContain('authjs.session-token=');

    const login = await loginRoute(request('/api/auth/password/login', {
      email: 'route@example.com',
      password: validPassword,
    }, '203.0.113.29'));
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('authjs.session-token=');

    const invalid = await loginRoute(request('/api/auth/password/login', {
      email: 'route@example.com',
      password: 'Wrong2026Password',
    }, '203.0.113.30'));
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({ error: 'INVALID_CREDENTIALS' });
  });

  it('rejects weak passwords and suspended accounts', async () => {
    await expect(registerPasswordAccount({ name: '林同学', email: 'weak@example.com', password: 'short' }, '203.0.113.31'))
      .resolves.toEqual({ success: false, error: 'INVALID_INPUT' });

    const registered = await registerPasswordAccount({ name: '林同学', email: 'suspended@example.com', password: validPassword }, '203.0.113.32');
    expect(registered.success).toBe(true);
    if (!registered.success) return;
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, registered.userId));

    await expect(loginWithPassword({ email: 'suspended@example.com', password: validPassword }, '203.0.113.33'))
      .resolves.toEqual({ success: false, error: 'ACCOUNT_SUSPENDED' });
  });
});
