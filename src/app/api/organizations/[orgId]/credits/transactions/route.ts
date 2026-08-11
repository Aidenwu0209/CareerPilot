import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { getOrCreateAccount, getTransactions } from '@/lib/credits/ledger';

/**
 * GET /api/organizations/[orgId]/credits/transactions
 *
 * AC3: Org admin can read paginated transactions for their org.
 * AC5: accountId is never accepted from client; always derived from orgId.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;

  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;

  const account = await getOrCreateAccount('organization', orgId);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const transactions = await getTransactions(account.id, { limit, offset });

  return NextResponse.json({
    transactions,
    pagination: { limit, offset, count: transactions.length },
    accountId: account.id,
  });
}
