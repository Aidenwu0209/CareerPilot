import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOrCreateAccount } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/credits/balance
 *
 * Returns the current user's personal credit balance.
 *
 * - Always resolves the account from the server-side session user.
 * - Never accepts an `accountId` parameter (prevents cross-account reads).
 * - Suspended users are rejected with ACCOUNT_SUSPENDED (AC5).
 */
export async function GET() {
  const ctx = await resolveActiveContext();

  if (ctx === null) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  const { actor, billing } = ctx.context;
  const account = await getOrCreateAccount(
    billing.accountOwnerType,
    billing.accountOwnerId,
  );

  // Fetch org name for ToB billing context so the UI can display it
  let orgName: string | null = null;
  if (billing.accountOwnerType === 'organization') {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, billing.accountOwnerId))
      .limit(1);
    orgName = org?.name ?? null;
  }

  return NextResponse.json({
    accountId: account.id,
    ownerType: account.ownerType,
    ownerId: account.ownerId,
    balance: account.balance,
    status: account.status,
    // Include org context so the UI can show which billing scope is active
    billingScope: billing.accountOwnerType === 'organization'
      ? { type: 'organization', id: billing.accountOwnerId, orgName }
      : { type: 'personal' },
    actor: { userId: actor.userId, platformRole: actor.platformRole },
  });
}
