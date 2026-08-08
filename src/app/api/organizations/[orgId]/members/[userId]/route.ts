import { NextResponse } from 'next/server';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { organizations, organizationMemberships, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * DELETE /api/organizations/[orgId]/members/[userId]
 *
 * Org admin: remove a member from the organization.
 *
 * AC3: Can only remove members of own org; cannot remove other org_admins
 * AC4: Removed member's org-scoped requests immediately rejected; historical data preserved
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
) {
  const { orgId, userId: targetUserId } = await params;

  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;

  // Find the membership
  const membership = await db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, targetUserId)))
    .limit(1);

  if (membership.length === 0) {
    return NextResponse.json({ error: 'MEMBERSHIP_NOT_FOUND' }, { status: 404 });
  }

  // AC3: Cannot remove another org_admin (only super_admin can manage admins)
  if (membership[0].role === 'org_admin' && guard.adminId !== targetUserId) {
    // Check if caller is super_admin (they can remove anyone)
    const callerIsSuper = await db
      .select({ platformRole: users.platformRole })
      .from(users)
      .where(eq(users.id, guard.adminId))
      .limit(1);

    if (callerIsSuper[0]?.platformRole !== 'super_admin') {
      return NextResponse.json({ error: 'CANNOT_REMOVE_ADMIN', detail: 'Only super admin can remove org_admins' }, { status: 403 });
    }
  }

  // Already removed?
  if (membership[0].status === 'removed') {
    return NextResponse.json({ error: 'ALREADY_REMOVED' }, { status: 409 });
  }

  // AC4: Mark as removed (preserve historical data)
  await db.update(organizationMemberships)
    .set({ status: 'removed', updatedAt: new Date() })
    .where(eq(organizationMemberships.id, membership[0].id));

  // Get org name for audit
  const org = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const targetUser = await db.select({ email: users.email }).from(users).where(eq(users.id, targetUserId)).limit(1);

  // Audit event
  await recordAuditEvent({
    actorId: guard.adminId,
    action: 'org.member.remove',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Removed member ${targetUser[0]?.email ?? targetUserId} from '${org[0]?.name ?? orgId}'`,
  });

  return NextResponse.json({
    organizationId: orgId,
    userId: targetUserId,
    status: 'removed',
  });
}
