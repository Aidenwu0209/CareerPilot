import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decode } from 'next-auth/jwt';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});
vi.mock('@/lib/db/sample-resume', () => ({ createSampleResume: vi.fn() }));

import { db } from '@/lib/db';
import { legalConsents, users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import {
  completeOnboarding,
  isOnboardingRequired,
  validateOnboardingProfile,
} from './onboarding';
import { createAuthSessionCookie } from './session-cookie';

const AUTH_SECRET = 'test-secret-with-sufficient-length-32chars!';

vi.stubEnv('AUTH_SECRET', AUTH_SECRET);

beforeEach(async () => {
  db.run(sql`DROP TRIGGER IF EXISTS legal_consents_no_delete`);
  db.run(sql`DROP TRIGGER IF EXISTS legal_consents_no_update`);
  db.run(sql`DELETE FROM legal_consents`);
  db.run(sql`CREATE TRIGGER legal_consents_no_update BEFORE UPDATE ON legal_consents BEGIN SELECT RAISE(ABORT, 'legal_consents is immutable'); END`);
  db.run(sql`CREATE TRIGGER legal_consents_no_delete BEFORE DELETE ON legal_consents BEGIN SELECT RAISE(ABORT, 'legal_consents is immutable'); END`);
  await db.delete(users);
});

describe('new user onboarding', () => {
  it('requires every base profile field', () => {
    const result = validateOnboardingProfile({ name: 'Ada' });
    expect(result).toEqual({
      success: false,
      fields: ['school', 'major', 'academicStage', 'careerDirection'],
    });
  });

  it('stores the profile, completes onboarding, and records both consents', async () => {
    await db.insert(users).values({
      id: 'new-user',
      email: 'new@test.com',
      authType: 'email',
      settings: { onboardingRequired: true, existingPreference: true },
    });
    const profile = {
      name: 'Ada Lovelace',
      school: 'Career University',
      major: 'Computer Science',
      academicStage: '2027',
      careerDirection: 'Software engineering',
    };

    await completeOnboarding({ userId: 'new-user', profile });

    const [user] = await db.select().from(users);
    expect(user.name).toBe('Ada Lovelace');
    expect(user.settings).toMatchObject({
      ...profile,
      existingPreference: true,
      onboardingRequired: false,
      program: 'Computer Science',
      cohort: '2027',
    });
    expect(isOnboardingRequired(user.settings)).toBe(false);
    const consents = await db.select().from(legalConsents);
    expect(consents).toHaveLength(2);
    expect(consents.every((consent: { source: string }) => consent.source === 'registration')).toBe(true);
  });

  it('refreshes the same user session with onboarding disabled', async () => {
    await db.insert(users).values({
      id: 'session-refresh-user',
      email: 'session-refresh@test.com',
      authType: 'email',
      settings: { onboardingRequired: true },
    });

    await completeOnboarding({
      userId: 'session-refresh-user',
      profile: {
        name: 'Session User',
        school: 'Career University',
        major: 'Computer Science',
        academicStage: '2027',
        careerDirection: 'Software engineering',
      },
    });

    const sessionCookie = await createAuthSessionCookie('session-refresh-user');
    const decoded = await decode({
      token: sessionCookie.value,
      secret: AUTH_SECRET,
      salt: sessionCookie.name,
    });

    expect(sessionCookie.name).toBe('authjs.session-token');
    expect(sessionCookie.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(decoded).toMatchObject({
      userId: 'session-refresh-user',
      sub: 'session-refresh-user',
      email: 'session-refresh@test.com',
      onboardingRequired: false,
      authType: 'email',
    });
  });

  it('treats historical accounts without the flag as already onboarded', () => {
    expect(isOnboardingRequired({})).toBe(false);
    expect(isOnboardingRequired(null)).toBe(false);
  });

  it('rejects profile mutation for an account that is not awaiting onboarding', async () => {
    await db.insert(users).values({
      id: 'existing-user',
      email: 'existing@test.com',
      authType: 'email',
    });

    await expect(completeOnboarding({
      userId: 'existing-user',
      profile: {
        name: 'Existing User',
        school: 'School',
        major: 'Major',
        academicStage: '2026',
        careerDirection: 'Engineering',
      },
    })).rejects.toThrow('ONBOARDING_NOT_REQUIRED');
  });
});
