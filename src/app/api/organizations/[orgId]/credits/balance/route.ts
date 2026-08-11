import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOrCreateAccount } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { organizations, organizationMemberships } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/organizations/[orgId]/credits/balance
 *
 * Returns the organization's credit balance.
 *
 * AC3: Org admin sees full details (balance, accountId, status)
 * AC4: Regular member sees limited summary (balance only)
 * AC5: Cross-org accountId never accepted from client
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const { orgId } = await params;
  const userId = ctx.context.actor.userId;

  // Verify org exists
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  // Check membership
  const membership = await db
    .select({ role: organizationMemberships.role, status: organizationMemberships.status })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, orgId),
      eq(organizationMemberships.userId, userId),
    ))
    .limit(1);

  // Super admin bypasses membership check
  const isSuperAdmin = ctx.context.actor.platformRole === 'super_admin';
  if (membership.length === 0 && !isSuperAdmin) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const isActiveMember = membership.length > 0 && membership[0].status === 'active';
  if (!isActiveMember && !isSuperAdmin) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const isAdmin = isSuperAdmin || (membership[0]?.role === 'org_admin');
  const account = await getOrCreateAccount('organization', orgId);

  // AC3: Org admin sees full details
  if (isAdmin) {
    return NextResponse.json({
      balance: account.balance,
      accountId: account.id,
      ownerType: 'organization',
      ownerId: orgId,
      status: account.status,
    });
  }

  // AC4: Regular member sees limited summary
  return NextResponse.json({
    balance: account.balance,
    ownerType: 'organization',
  });
}
