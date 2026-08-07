import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, authAccounts } from '@/lib/db/schema';
import { authAccountRepository } from '@/lib/db/repositories/auth-account.repository';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { createSampleResume } from '@/lib/db/sample-resume';

export interface OAuthLinkResult {
  userId: string;
  isNewUser: boolean;
  isNewLink: boolean;
}

/**
 * Resolve or create a persistent OAuth account link.
 *
 * Resolution order:
 * 1. Existing (provider, providerAccountId) → reuse linked userId
 * 2. Existing user with same email → link auth account to that user
 * 3. No match → create new user + auth account atomically
 *
 * If any step fails, no half-created records remain (transactional).
 */
export async function resolveOAuthAccount(params: {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}): Promise<OAuthLinkResult> {
  // Step 1: Look up by stable (provider, providerAccountId)
  const existingAccount = await authAccountRepository.findByProviderAndAccountId(
    params.provider,
    params.providerAccountId,
  );
  if (existingAccount) {
    // Verify the linked user still exists
    const linkedUser = await userRepository.findById(existingAccount.userId);
    if (linkedUser) {
      return { userId: linkedUser.id, isNewUser: false, isNewLink: false };
    }
    // Orphaned account — clean it up and continue to create fresh
    await db.delete(authAccounts).where(eq(authAccounts.id, existingAccount.id));
  }

  // Step 2: Try email-based linking (explicit security rule)
  const existingUser = params.email
    ? await userRepository.findByEmail(params.email)
    : null;

  if (existingUser) {
    // Link the OAuth provider to the existing user
    await authAccountRepository.create({
      userId: existingUser.id,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenType: params.tokenType,
      expiresAt: params.expiresAt,
      scope: params.scope,
    });
    return { userId: existingUser.id, isNewUser: false, isNewLink: true };
  }

  // Step 3: Create new user + auth account atomically (synchronous transaction for better-sqlite3)
  const newUserId = crypto.randomUUID();
  db.transaction((tx: typeof db) => {
    tx.insert(users).values({
      id: newUserId,
      email: params.email || undefined,
      name: params.name || undefined,
      avatarUrl: params.avatarUrl || undefined,
      authType: 'oauth',
    }).run();
    tx.insert(authAccounts).values({
      userId: newUserId,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenType: params.tokenType,
      expiresAt: params.expiresAt,
      scope: params.scope,
    }).run();
  });

  // Create sample resume outside the transaction (non-critical, idempotent)
  try {
    await createSampleResume(newUserId);
  } catch {
    // Sample resume failure should not block authentication
  }

  return { userId: newUserId, isNewUser: true, isNewLink: true };
}
