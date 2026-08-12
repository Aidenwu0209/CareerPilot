import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { authAccounts, users } from '@/lib/db/schema';

export interface NewAuthIdentity {
  user: {
    id: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
    authType: 'email' | 'oauth';
    settings: { onboardingRequired: true };
  };
  account: {
    id: string;
    userId: string;
    provider: string;
    providerAccountId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    tokenType?: string | null;
    expiresAt?: Date | null;
    scope?: string | null;
  };
}

function usesSynchronousSQLiteTransactions(database: typeof db): boolean {
  return database.session?.constructor?.name === 'BetterSQLiteSession';
}

/** Atomically create the user and its first auth account on either DB adapter. */
export async function createAuthIdentityWithDatabase(
  database: typeof db,
  dbType: 'sqlite' | 'postgresql',
  identity: NewAuthIdentity,
): Promise<void> {
  // Unit/integration tests frequently inject a real better-sqlite3 database
  // while retaining production-like DB_TYPE values. Prefer the actual session
  // capability so a synchronous SQLite transaction never receives a Promise.
  if (dbType === 'sqlite' || usesSynchronousSQLiteTransactions(database)) {
    database.transaction((tx: typeof db) => {
      tx.insert(users).values(identity.user).run();
      tx.insert(authAccounts).values(identity.account).run();
    });
    return;
  }

  await database.transaction(async (tx: typeof db) => {
    await tx.insert(users).values(identity.user);
    await tx.insert(authAccounts).values(identity.account);
  });
}

export async function createAuthIdentity(identity: NewAuthIdentity): Promise<void> {
  await createAuthIdentityWithDatabase(db, config.db.type, identity);
}
