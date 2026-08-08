import { redirect } from 'next/navigation';
import { resolveContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { organizations, organizationMemberships } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { MembersManager } from '@/components/org-admin/members-manager';

export default async function OrgAdminMembersPage() {
  const context = await resolveContext();
  if (!context) {
    redirect('/login?callbackUrl=/org-admin/members');
  }

  const userId = context.actor.userId;

  const orgInfo = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      seatLimit: organizations.seatLimit,
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

  if (orgInfo.length === 0) {
    // The layout guard will render NoPermission
    return null;
  }

  const org = orgInfo[0];
  return <MembersManager orgId={org.orgId} orgName={org.orgName} seatLimit={org.seatLimit} />;
}
