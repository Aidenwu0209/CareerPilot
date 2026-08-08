import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * US-053 tests: Legal consent version service
 *
 * Validates:
 * - AC1: First authentication records consent for current versions
 * - AC2: Consent records maintain full history with user, doc type, version, time, source
 * - AC3: Client cannot forge non-existent or expired document versions
 * - AC4: Re-consent detection: missing current version is detected
 * - AC5: Users can read own consent records, not others'
 */

// --- Mock the DB module ---
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

vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// --- Imports ---
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import {
  getCurrentVersion,
  getAllCurrentVersions,
  isValidVersion,
  recordConsent,
  recordAllConsents,
  hasCurrentConsent,
  checkAllCurrentConsents,
  getUserConsents,
  getConsentHistory,
} from './consent-service';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({ id, email, name: email.split('@')[0], authType: 'email' });
}

beforeEach(async () => {
  // legal_consents is immutable (triggers block DELETE) — drop triggers temporarily
  db.run(sql`DROP TRIGGER IF EXISTS legal_consents_no_delete`);
  db.run(sql`DROP TRIGGER IF EXISTS legal_consents_no_update`);
  db.run(sql`DELETE FROM legal_consents`);
  // Recreate triggers
  db.run(sql`CREATE TRIGGER legal_consents_no_update BEFORE UPDATE ON legal_consents BEGIN SELECT RAISE(ABORT, 'legal_consents is immutable'); END`);
  db.run(sql`CREATE TRIGGER legal_consents_no_delete BEFORE DELETE ON legal_consents BEGIN SELECT RAISE(ABORT, 'legal_consents is immutable'); END`);

  db.run(sql`PRAGMA foreign_keys = OFF`);
  await db.delete(users);
  db.run(sql`PRAGMA foreign_keys = ON`);
});

// ========== Version registry tests ==========
describe('Document version registry', () => {
  it('returns current version for privacy_policy', () => {
    const v = getCurrentVersion('privacy_policy');
    expect(v.version).toBe('2026-08-01-v1');
    expect(v.effectiveDate).toBeInstanceOf(Date);
  });

  it('returns current version for terms_of_service', () => {
    const v = getCurrentVersion('terms_of_service');
    expect(v.version).toBe('2026-08-01-v1');
    expect(v.effectiveDate).toBeInstanceOf(Date);
  });

  it('returns all current versions', () => {
    const all = getAllCurrentVersions();
    expect(all.privacy_policy.version).toBe('2026-08-01-v1');
    expect(all.terms_of_service.version).toBe('2026-08-01-v1');
  });

  it('validates known versions', () => {
    expect(isValidVersion('privacy_policy', '2026-08-01-v1')).toBe(true);
    expect(isValidVersion('terms_of_service', '2026-08-01-v1')).toBe(true);
  });

  it('rejects unknown versions (AC3)', () => {
    expect(isValidVersion('privacy_policy', 'fake-version')).toBe(false);
    expect(isValidVersion('privacy_policy', '2020-01-01-v0')).toBe(false);
    expect(isValidVersion('terms_of_service', 'invalid')).toBe(false);
  });
});

// ========== AC1: Recording consent ==========
describe('AC1: Record consent', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
  });

  it('records consent for privacy policy', async () => {
    const record = await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
    });

    expect(record.userId).toBe('user1');
    expect(record.documentType).toBe('privacy_policy');
    expect(record.version).toBe('2026-08-01-v1');
    expect(record.source).toBe('registration');
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  it('records consent for terms of service', async () => {
    const record = await recordConsent({
      userId: 'user1',
      documentType: 'terms_of_service',
      version: '2026-08-01-v1',
      source: 'explicit_reconsent',
    });

    expect(record.documentType).toBe('terms_of_service');
    expect(record.source).toBe('explicit_reconsent');
  });

  it('records all consents at once via recordAllConsents', async () => {
    const result = await recordAllConsents({
      userId: 'user1',
      source: 'registration',
    });

    expect(result.privacyPolicy.version).toBe('2026-08-01-v1');
    expect(result.termsOfService.version).toBe('2026-08-01-v1');
  });

  it('throws on invalid version (AC3)', async () => {
    await expect(
      recordConsent({
        userId: 'user1',
        documentType: 'privacy_policy',
        version: 'fake-version',
        source: 'registration',
      }),
    ).rejects.toThrow('INVALID_VERSION');
  });

  it('stores IP address when provided', async () => {
    const record = await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
      ipAddress: '192.168.1.1',
    });

    expect(record.ipAddress).toBe('192.168.1.1');
  });
});

// ========== AC2: History preservation ==========
describe('AC2: Full consent history', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
  });

  it('maintains separate records for each consent event', async () => {
    await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
    });

    await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'explicit_reconsent',
    });

    const history = await getConsentHistory('user1', 'privacy_policy');
    expect(history).toHaveLength(2);
    const sources = history.map(r => r.source).sort();
    expect(sources).toEqual(['explicit_reconsent', 'registration']);
  });

  it('stores user, doc type, version, time, and source in each record', async () => {
    await recordConsent({
      userId: 'user1',
      documentType: 'terms_of_service',
      version: '2026-08-01-v1',
      source: 'login',
      ipAddress: '10.0.0.1',
    });

    const history = await getConsentHistory('user1', 'terms_of_service');
    expect(history).toHaveLength(1);
    const r = history[0];
    expect(r.userId).toBe('user1');
    expect(r.documentType).toBe('terms_of_service');
    expect(r.version).toBe('2026-08-01-v1');
    expect(r.source).toBe('login');
    expect(r.ipAddress).toBe('10.0.0.1');
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.effectiveDate).toBeInstanceOf(Date);
  });
});

// ========== AC3: Version forgery prevention ==========
describe('AC3: Version forgery prevention', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
  });

  it('rejects consent with unknown version', async () => {
    await expect(
      recordConsent({
        userId: 'user1',
        documentType: 'privacy_policy',
        version: '2099-01-01-v99',
        source: 'registration',
      }),
    ).rejects.toThrow('INVALID_VERSION');
  });

  it('rejects consent with empty version', async () => {
    await expect(
      recordConsent({
        userId: 'user1',
        documentType: 'privacy_policy',
        version: '',
        source: 'registration',
      }),
    ).rejects.toThrow('INVALID_VERSION');
  });

  it('validates version before any DB write', async () => {
    try {
      await recordConsent({
        userId: 'user1',
        documentType: 'privacy_policy',
        version: 'invalid',
        source: 'registration',
      });
    } catch {
      // expected
    }

    const history = await getConsentHistory('user1');
    expect(history).toHaveLength(0);
  });
});

// ========== AC4: Re-consent detection ==========
describe('AC4: Re-consent detection', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
  });

  it('detects missing consent for new user', async () => {
    const result = await checkAllCurrentConsents('user1');
    expect(result.allConsented).toBe(false);
    expect(result.missing).toContain('privacy_policy');
    expect(result.missing).toContain('terms_of_service');
  });

  it('detects partial consent', async () => {
    await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
    });

    const result = await checkAllCurrentConsents('user1');
    expect(result.allConsented).toBe(false);
    expect(result.missing).toEqual(['terms_of_service']);
  });

  it('returns allConsented=true when both are recorded', async () => {
    await recordAllConsents({ userId: 'user1', source: 'registration' });

    const result = await checkAllCurrentConsents('user1');
    expect(result.allConsented).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('hasCurrentConsent returns true after recording', async () => {
    await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
    });

    expect(await hasCurrentConsent('user1', 'privacy_policy')).toBe(true);
    expect(await hasCurrentConsent('user1', 'terms_of_service')).toBe(false);
  });
});

// ========== AC5: User-scoped reading ==========
describe('AC5: User-scoped consent reading', () => {
  beforeEach(async () => {
    await seedUser('user1', 'user1@test.com');
    await seedUser('user2', 'user2@test.com');
  });

  it('returns user own latest consent records', async () => {
    await recordAllConsents({ userId: 'user1', source: 'registration' });

    const consents = await getUserConsents('user1');
    expect(consents.privacy_policy).not.toBeNull();
    expect(consents.terms_of_service).not.toBeNull();
    expect(consents.privacy_policy!.version).toBe('2026-08-01-v1');
  });

  it('returns null for user with no consents', async () => {
    const consents = await getUserConsents('user2');
    expect(consents.privacy_policy).toBeNull();
    expect(consents.terms_of_service).toBeNull();
  });

  it('user1 cannot read user2 consents via getUserConsents', async () => {
    await recordAllConsents({ userId: 'user2', source: 'registration' });

    // Querying user1's consents should not return user2's records
    const consents = await getUserConsents('user1');
    expect(consents.privacy_policy).toBeNull();
    expect(consents.terms_of_service).toBeNull();
  });

  it('getConsentHistory only returns the specified user records', async () => {
    await recordConsent({
      userId: 'user1',
      documentType: 'privacy_policy',
      version: '2026-08-01-v1',
      source: 'registration',
    });
    await recordAllConsents({ userId: 'user2', source: 'registration' });

    const user1History = await getConsentHistory('user1');
    const user2History = await getConsentHistory('user2');

    expect(user1History.every(r => r.userId === 'user1')).toBe(true);
    expect(user2History.every(r => r.userId === 'user2')).toBe(true);
    expect(user1History.length).toBeLessThan(user2History.length);
  });
});
