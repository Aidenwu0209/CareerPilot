/**
 * Session claims refresh service.
 *
 * Provides functions to fetch the latest platform role and account status
 * from the database so that JWT tokens stay reasonably fresh without
 * long-term trusting stale values.
 */

import { userRepository } from '@/lib/db/repositories/user.repository';

/** How often (in seconds) the JWT should re-fetch claims from the DB. */
export const REFRESH_INTERVAL_SECONDS = 60;

export interface UserClaims {
  userId: string;
  platformRole: 'super_admin' | 'user';
  status: 'active' | 'suspended' | 'deleted';
}

/**
 * Fetch the latest platformRole and status for a user from the database.
 * Returns null if the user no longer exists (e.g. deleted).
 */
export async function refreshUserClaims(userId: string): Promise<UserClaims | null> {
  const user = await userRepository.findById(userId);
  if (!user) return null;
  return {
    userId: user.id,
    platformRole: user.platformRole,
    status: user.status,
  };
}

/**
 * Determine whether the cached claims in a JWT are stale and should be refreshed.
 */
export function shouldRefresh(lastRefreshAt: number | undefined): boolean {
  if (!lastRefreshAt) return true;
  const now = Math.floor(Date.now() / 1000);
  return now - lastRefreshAt > REFRESH_INTERVAL_SECONDS;
}
