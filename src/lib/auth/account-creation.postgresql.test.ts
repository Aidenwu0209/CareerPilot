import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { authAccounts, users } from '@/lib/db/schema';
import { createAuthIdentityWithDatabase } from './account-creation';

vi.setConfig({ testTimeout: 30_000 });

describe('PostgreSQL auth identity creation', () => {
  let client: PGlite;
  let pgDb: any;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    pgDb = drizzle(client);
    await migrate(pgDb, {
      migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
    });
  });

  beforeEach(async () => {
    await pgDb.delete(authAccounts);
    await pgDb.delete(users);
  });

  afterAll(async () => {
    await client.close();
  });

  function identity(id: string, email: string) {
    return {
      user: {
        id,
        email,
        authType: 'email' as const,
        settings: { onboardingRequired: true as const },
      },
      account: {
        id: `${id}-account`,
        userId: id,
        provider: 'email',
        providerAccountId: email,
      },
    };
  }

  it('creates the user and auth account in a PostgreSQL async transaction', async () => {
    await createAuthIdentityWithDatabase(
      pgDb,
      'postgresql',
      identity('pg-new-user', 'pg-new@test.com'),
    );

    const [user] = await pgDb.select().from(users).where(eq(users.id, 'pg-new-user'));
    const [account] = await pgDb
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.userId, 'pg-new-user'));
    expect(user).toMatchObject({
      email: 'pg-new@test.com',
      authType: 'email',
      settings: { onboardingRequired: true },
    });
    expect(account).toMatchObject({
      provider: 'email',
      providerAccountId: 'pg-new@test.com',
    });
  });

  it('rolls back the user when the auth account insert conflicts', async () => {
    await createAuthIdentityWithDatabase(
      pgDb,
      'postgresql',
      identity('existing-user', 'collision@test.com'),
    );

    await expect(createAuthIdentityWithDatabase(
      pgDb,
      'postgresql',
      {
        ...identity('rolled-back-user', 'other@test.com'),
        account: {
          id: 'different-account-id',
          userId: 'rolled-back-user',
          provider: 'email',
          providerAccountId: 'collision@test.com',
        },
      },
    )).rejects.toThrow();

    const rolledBack = await pgDb
      .select()
      .from(users)
      .where(eq(users.id, 'rolled-back-user'));
    expect(rolledBack).toHaveLength(0);
  });

  it('uses synchronous transactions for an injected SQLite test DB despite a PostgreSQL env', async () => {
    const sqlite = new Database(':memory:');
    const sqliteDb = drizzleSqlite(sqlite);
    migrateSqlite(sqliteDb, {
      migrationsFolder: resolve(process.cwd(), 'drizzle/migrations'),
    });

    try {
      await createAuthIdentityWithDatabase(
        sqliteDb as unknown as Parameters<typeof createAuthIdentityWithDatabase>[0],
        'postgresql',
        identity('sqlite-mock-user', 'sqlite-mock@test.com'),
      );
      const [user] = await sqliteDb
        .select()
        .from(users)
        .where(eq(users.id, 'sqlite-mock-user'));
      expect(user?.email).toBe('sqlite-mock@test.com');
    } finally {
      sqlite.close();
    }
  });
});
