import { NextResponse } from 'next/server';
import { resolveActiveContext, type ActiveContextResult } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { organizations, organizationMemberships } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Resolve the org-admin context for a specific organization.
 *
 * This goes beyond resolveActiveContext by:
 * 1. Checking auth + suspended status (via resolveActiveContext)
 * 2. Verifying the caller is an active org_admin of the specified org
 * 3. Verifying the org itself is active
 *
 * Returns the caller's userId on success, or a NextResponse on failure.
 */
export async function resolveOrgAdmin(
  orgId: string,
): Promise<{ ok: true; adminId: string } | { ok: false; response: NextResponse }> {
  const ctx: ActiveContextResult = await resolveActiveContext();

  if (ctx === null) {
    return { ok: false, response: NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 }) };
  }
  if (!ctx.ok) return { ok: false, response: ctx.response };

  const adminId = ctx.context.actor.userId;

  // Super admin bypasses org-admin check
  if (ctx.context.actor.platformRole === 'super_admin') {
    return { ok: true, adminId };
  }

  // Verify org exists and is active
  const org = await db
    .select({ id: organizations.id, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (org.length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 }) };
  }

  if (org[0].status !== 'active') {
    return { ok: false, response: NextResponse.json({ error: 'ORG_SUSPENDED' }, { status: 403 }) };
  }

  // Verify caller is an active org_admin of this org
  const membership = await db
    .select()
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, orgId),
        eq(organizationMemberships.userId, adminId),
        eq(organizationMemberships.role, 'org_admin'),
        eq(organizationMemberships.status, 'active'),
      ),
    )
    .limit(1);

  if (membership.length === 0) {
    return { ok: false, response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  }

  return { ok: true, adminId };
}
