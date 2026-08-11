import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { users, creditAccounts, organizationMemberships, organizations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/admin/users/[id]
 *
 * Super admin: view a specific user's details.
 * Shows role, status, balance, and org membership.
 * Does NOT show resumes, interview text, auth tokens, or AI keys (AC5).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;

  const userRow = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (userRow.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }
  const user = userRow[0];

  // Personal balance
  const acct = await db
    .select({ id: creditAccounts.id, balance: creditAccounts.balance })
    .from(creditAccounts)
    .where(and(eq(creditAccounts.ownerType, 'user'), eq(creditAccounts.ownerId, id)))
    .limit(1);

  // Org memberships
  const memberships = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgStatus: organizations.status,
      orgRole: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, id));

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    platformRole: user.platformRole,
    status: user.status,
    createdAt: user.createdAt,
    balance: acct[0]?.balance ?? 0,
    accountId: acct[0]?.id ?? null,
    organizations: memberships,
  });
}
