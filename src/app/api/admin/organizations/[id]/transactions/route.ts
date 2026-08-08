import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOrCreateAccount, getTransactions } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/admin/organizations/[id]/transactions
 *
 * Super admin: view a specific organization's paginated credit transactions.
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

  const { id: orgId } = await params;

  // Verify org exists
  const org = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const account = await getOrCreateAccount('organization', orgId);
  const transactions = await getTransactions(account.id, { limit, offset });

  return NextResponse.json({
    accountId: account.id,
    balance: account.balance,
    transactions,
    pagination: { limit, offset, count: transactions.length },
  });
}
