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

/** Atomically create the user and its first auth account on either DB adapter. */
export async function createAuthIdentityWithDatabase(
  database: typeof db,
  dbType: 'sqlite' | 'postgresql',
  identity: NewAuthIdentity,
): Promise<void> {
  if (dbType === 'sqlite') {
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
