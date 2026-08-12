import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { authAccounts } from '@/lib/db/schema';
import { authAccountRepository } from '@/lib/db/repositories/auth-account.repository';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { createSampleResume } from '@/lib/db/sample-resume';
import { applyRegistrationGrant } from '@/lib/credits/registration-grant';
import { assertRealAccountCanLink } from './onboarding';
import { createAuthIdentity } from './account-creation';

export interface OAuthLinkResult {
  userId: string;
  isNewUser: boolean;
  isNewLink: boolean;
}

export function isVerifiedGoogleProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const value = profile as { email?: unknown; email_verified?: unknown };
  return typeof value.email === 'string'
    && value.email.length > 0
    && value.email_verified === true;
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
      assertRealAccountCanLink(linkedUser);
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
    assertRealAccountCanLink(existingUser);
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

  // Step 3: Create new user + auth account atomically on either DB adapter.
  const newUserId = crypto.randomUUID();
  await createAuthIdentity({
    user: {
      id: newUserId,
      email: params.email || undefined,
      name: params.name || undefined,
      avatarUrl: params.avatarUrl || undefined,
      authType: 'oauth',
      settings: { onboardingRequired: true },
    },
    account: {
      id: crypto.randomUUID(),
      userId: newUserId,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenType: params.tokenType,
      expiresAt: params.expiresAt,
      scope: params.scope,
    },
  });

  // Create sample resume outside the transaction (non-critical, idempotent)
  try {
    await createSampleResume(newUserId);
  } catch {
    // Sample resume failure should not block authentication
  }

  // Apply one-time registration grant (idempotent — safe even on callback replay)
  try {
    await applyRegistrationGrant(newUserId);
  } catch {
    // Grant failure should not block authentication
  }

  return { userId: newUserId, isNewUser: true, isNewLink: true };
}
