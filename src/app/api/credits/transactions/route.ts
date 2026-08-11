import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOrCreateAccount, getTransactions } from '@/lib/credits/ledger';

/**
 * GET /api/credits/transactions
 *
 * Returns paginated credit transactions for the current user's billing account.
 *
 * Query params:
 *   - limit:  page size (default 50, max 100)
 *   - offset: pagination offset (default 0)
 *
 * - Always resolves the account from the server-side session user.
 * - Never accepts an `accountId` parameter (prevents cross-account reads, AC4).
 * - Returns empty list when no transactions exist (AC5).
 * - Suspended users are rejected (AC5).
 */
export async function GET(request: Request) {
  const ctx = await resolveActiveContext();

  if (ctx === null) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  const { billing } = ctx.context;
  const account = await getOrCreateAccount(
    billing.accountOwnerType,
    billing.accountOwnerId,
  );

  // Parse pagination params with server-side limits
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const transactions = await getTransactions(account.id, { limit, offset });

  return NextResponse.json({
    accountId: account.id,
    balance: account.balance,
    transactions,
    pagination: { limit, offset, count: transactions.length },
  });
}
