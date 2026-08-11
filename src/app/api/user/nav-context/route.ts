import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organizationMemberships, organizations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/user/nav-context
 *
 * Returns the user's role context for navigation rendering.
 * - platformRole: 'super_admin' | 'user'
 * - isOrgAdmin: whether the user is an active org_admin of any active org
 * - orgId: the organization ID if the user is an org admin (null otherwise)
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const userId = ctx.context.actor.userId;
  const platformRole = ctx.context.actor.platformRole;

  // Check if user is an active org_admin of any active org
  const memberships = await db
    .select({
      orgId: organizationMemberships.organizationId,
      orgName: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.role, 'org_admin'),
        eq(organizationMemberships.status, 'active'),
        eq(organizations.status, 'active'),
      ),
    )
    .limit(1);

  const isOrgAdmin = memberships.length > 0;

  return NextResponse.json({
    platformRole,
    isOrgAdmin,
    orgId: memberships[0]?.orgId ?? null,
    orgName: memberships[0]?.orgName ?? null,
  });
}
