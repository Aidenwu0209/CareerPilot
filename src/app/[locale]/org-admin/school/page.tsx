import { and, eq } from 'drizzle-orm';
import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { db } from '@/lib/db';
import { organizationMemberships, organizations } from '@/lib/db/schema';
import { SchoolSettings } from '@/components/org-admin/school-settings';

export default async function OrgAdminSchoolPage() {
  const context = await resolveServerContext();
  if (!context) return redirectToLogin('/org-admin/school');
  const [org] = await db.select({ id: organizations.id, kind: organizations.kind }).from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(
      eq(organizationMemberships.userId, context.actor.userId), eq(organizationMemberships.role, 'org_admin'),
      eq(organizationMemberships.status, 'active'), eq(organizations.status, 'active'),
    )).limit(1);
  if (!org || org.kind !== 'school') return <p className="text-sm text-muted-foreground">This organization is not configured as a school.</p>;
  return <SchoolSettings orgId={org.id} />;
}
