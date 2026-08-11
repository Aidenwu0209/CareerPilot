import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOrCreateAccount, getTransactions } from '@/lib/credits/ledger';

/**
 * GET /api/admin/users/[id]/transactions
 *
 * Super admin: view a specific user's paginated credit transactions.
 * Does NOT return business content (resumes, prompts, etc.) — only ledger metadata.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id: targetId } = await params;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const account = await getOrCreateAccount('user', targetId);
  const transactions = await getTransactions(account.id, { limit, offset });

  return NextResponse.json({
    accountId: account.id,
    balance: account.balance,
    transactions,
    pagination: { limit, offset, count: transactions.length },
  });
}
