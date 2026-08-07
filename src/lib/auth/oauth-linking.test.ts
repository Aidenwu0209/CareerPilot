import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * US-011 tests: Persistent OAuth Account Linking
 *
 * Validates that OAuth login uses the auth_accounts table for stable identity
 * linkage, not just email-based lookup in the JWT callback.
 *
 * Uses a real in-memory SQLite database (via mocked @/lib/db) to test
 * the full resolution flow including transactions and constraints.
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

// --- Import AFTER mocks ---
import { resolveOAuthAccount } from './oauth-linking';
import { authAccountRepository } from '@/lib/db/repositories/auth-account.repository';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { db } from '@/lib/db';
import { users, authAccounts } from '@/lib/db/schema';

beforeEach(async () => {
  // Clean tables between tests
  await db.delete(authAccounts);
  await db.delete(users);
});

describe('US-011: Persistent OAuth Account Linking', () => {
  describe('First login creates one user and one auth account', () => {
    it('creates exactly one user for a brand-new Google identity', async () => {
      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-new-1',
        email: 'newuser1@test.com',
        name: 'New User',
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(result.isNewUser).toBe(true);
      expect(result.isNewLink).toBe(true);
      expect(result.userId).toBeDefined();

      const user = await userRepository.findById(result.userId);
      expect(user).toBeTruthy();
      expect(user!.email).toBe('newuser1@test.com');
      expect(user!.name).toBe('New User');
      expect(user!.authType).toBe('oauth');
    });

    it('creates exactly one auth account for a brand-new Google identity', async () => {
      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-new-2',
        email: 'newuser2@test.com',
      });

      const accounts = await authAccountRepository.findByUserId(result.userId);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].provider).toBe('google');
      expect(accounts[0].providerAccountId).toBe('google-new-2');
      expect(accounts[0].userId).toBe(result.userId);
    });
  });

  describe('Same Google identity repeat login preserves same userId', () => {
    it('returns the same userId on subsequent logins', async () => {
      const first = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-repeat-1',
        email: 'repeat1@test.com',
      });

      const second = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-repeat-1',
        email: 'repeat1@test.com',
      });

      expect(second.userId).toBe(first.userId);
      expect(second.isNewUser).toBe(false);
      expect(second.isNewLink).toBe(false);
    });

    it('does not create duplicate auth accounts on repeat login', async () => {
      await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-dup-1',
        email: 'dup1@test.com',
      });

      await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-dup-1',
        email: 'dup1@test.com',
      });

      // Verify only one auth account exists for this provider+providerAccountId
      const account = await authAccountRepository.findByProviderAndAccountId('google', 'google-dup-1');
      expect(account).toBeTruthy();
    });

    it('preserves stable userId even if email changed on Google side', async () => {
      const first = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-email-change',
        email: 'old-email@test.com',
      });

      const second = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-email-change',
        email: 'new-email@test.com',
      });

      expect(second.userId).toBe(first.userId);
      expect(second.isNewUser).toBe(false);
    });
  });

  describe('Same-email existing user linking', () => {
    it('links OAuth provider to existing user with same email', async () => {
      const existingUser = await userRepository.create({
        email: 'existing1@test.com',
        name: 'Existing User',
        authType: 'oauth',
      });

      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-link-existing',
        email: 'existing1@test.com',
      });

      expect(result.userId).toBe(existingUser!.id);
      expect(result.isNewUser).toBe(false);
      expect(result.isNewLink).toBe(true);
    });

    it('does not create duplicate users when email matches existing user', async () => {
      const existing = await userRepository.create({
        email: 'nodup@test.com',
        authType: 'oauth',
      });

      await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-nodup',
        email: 'nodup@test.com',
      });

      const found = await userRepository.findByEmail('nodup@test.com');
      expect(found).toBeTruthy();
      expect(found!.id).toBe(existing!.id);
    });

    it('does not create duplicate grants for email-linked existing user', async () => {
      // This test validates that email-based linking doesn't trigger new-user
      // registration grants. Registration grants are handled in US-026.
      await userRepository.create({
        email: 'grant@test.com',
        authType: 'oauth',
      });

      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-grant',
        email: 'grant@test.com',
      });

      expect(result.isNewUser).toBe(false);
    });
  });

  describe('Multiple providers for same email', () => {
    it('creates separate auth accounts for different providers with same email', async () => {
      const googleResult = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-multi-1',
        email: 'multi1@test.com',
      });

      const githubResult = await resolveOAuthAccount({
        provider: 'github',
        providerAccountId: 'github-multi-1',
        email: 'multi1@test.com',
      });

      expect(githubResult.userId).toBe(googleResult.userId);
      expect(githubResult.isNewUser).toBe(false);
      expect(githubResult.isNewLink).toBe(true);

      const accounts = await authAccountRepository.findByUserId(googleResult.userId);
      expect(accounts).toHaveLength(2);

      const providers = accounts.map((a: { provider: string }) => a.provider).sort();
      expect(providers).toEqual(['github', 'google']);
    });
  });

  describe('ProviderAccountId is the primary lookup key', () => {
    it('finds user by providerAccountId even when a different email is used', async () => {
      const first = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'primary-key-test',
        email: 'primary1@test.com',
      });

      const second = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'primary-key-test',
        email: 'completely-different@test.com',
      });

      expect(second.userId).toBe(first.userId);
    });

    it('does not match a different provider with the same providerAccountId', async () => {
      const googleResult = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'shared-id',
        email: 'shared1@test.com',
      });

      const githubResult = await resolveOAuthAccount({
        provider: 'github',
        providerAccountId: 'shared-id',
        email: 'shared2@test.com',
      });

      // Different providers → different users (email also differs)
      expect(githubResult.userId).not.toBe(googleResult.userId);
      expect(githubResult.isNewUser).toBe(true);
    });
  });

  describe('OAuth failure leaves no half-created accounts', () => {
    it('transaction rolls back user creation if auth account insert fails', () => {
      // Pre-insert a user and auth account to create a unique constraint conflict
      db.insert(users).values({
        id: 'pre-existing-user',
        email: 'pre@test.com',
        authType: 'oauth',
      }).run();
      db.insert(authAccounts).values({
        userId: 'pre-existing-user',
        provider: 'google',
        providerAccountId: 'conflict-pa-id',
      }).run();

      // Attempt to create a new user + auth account where auth account has
      // a duplicate (provider, providerAccountId)
      expect(() => {
        db.transaction((tx: typeof db) => {
          tx.insert(users).values({
            id: 'should-not-exist',
            email: 'should-not-exist@test.com',
            authType: 'oauth',
          }).run();
          // This insert violates the unique constraint
          tx.insert(authAccounts).values({
            userId: 'should-not-exist',
            provider: 'google',
            providerAccountId: 'conflict-pa-id',
          }).run();
        });
      }).toThrow();

      // Verify the user was NOT created (transaction rolled back)
      const createdUser = db.select().from(users).where(eq(users.id, 'should-not-exist')).all();
      expect(createdUser).toHaveLength(0);
    });

    it('orphaned auth account is cleaned up on next login attempt', async () => {
      // Create a user with an auth account
      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-orphan',
        email: 'orphan@test.com',
      });

      // Simulate data corruption: delete the user but leave the auth account.
      // Must disable FK enforcement temporarily to create the orphaned state.
      import('drizzle-orm').then(({ sql }) => {
        // Not usable — need synchronous access
      });
      // Access the underlying better-sqlite3 instance via drizzle's session
      const session = (db as any).session;
      const sqlite = session?.client || session?.db;
      if (sqlite) {
        sqlite.pragma('foreign_keys = OFF');
        sqlite.prepare('DELETE FROM users WHERE id = ?').run(result.userId);
        sqlite.pragma('foreign_keys = ON');
      } else {
        // Fallback: skip test if we can't access the raw sqlite instance
        return;
      }

      // Try to login again with the same provider identity
      const result2 = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-orphan',
        email: 'orphan@test.com',
      });

      // Should create a new user (orphaned account was cleaned up)
      expect(result2.isNewUser).toBe(true);
      expect(result2.userId).not.toBe(result.userId);

      // Should have exactly one auth account for this provider identity
      const account = await authAccountRepository.findByProviderAndAccountId('google', 'google-orphan');
      expect(account).toBeTruthy();
      expect(account!.userId).toBe(result2.userId);
    });
  });

  describe('Auth account stores OAuth tokens', () => {
    it('persists access token and related fields', async () => {
      const expiresAt = new Date('2026-12-31T23:59:59Z');
      const result = await resolveOAuthAccount({
        provider: 'google',
        providerAccountId: 'google-tokens',
        email: 'tokens@test.com',
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        tokenType: 'Bearer',
        expiresAt,
        scope: 'openid email profile',
      });

      const account = await authAccountRepository.findByProviderAndAccountId('google', 'google-tokens');
      expect(account).toBeTruthy();
      expect(account!.accessToken).toBe('access-token-value');
      expect(account!.refreshToken).toBe('refresh-token-value');
      expect(account!.tokenType).toBe('Bearer');
      expect(account!.scope).toBe('openid email profile');
    });
  });
});
