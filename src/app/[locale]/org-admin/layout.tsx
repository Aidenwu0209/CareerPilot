import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { db } from '@/lib/db';
import { organizations, organizationMemberships } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Header } from '@/components/layout/header';
import { OrgAdminSidebar } from '@/components/org-admin/org-admin-sidebar';
import { NoPermission } from '@/components/admin/no-permission';
import { getTranslations } from 'next-intl/server';

export default async function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveServerContext();
  const t = await getTranslations('orgAdmin');

  if (!context) {
    return redirectToLogin('/org-admin');
  }

  // Super admin can view org-admin if they belong to an org; otherwise deny
  // Regular users must be active org_admin of an active org
  const userId = context.actor.userId;

  const membership = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgStatus: organizations.status,
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

  const isOrgAdmin = membership.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <div className="mx-auto flex max-w-7xl">
        {isOrgAdmin ? (
          <>
            <OrgAdminSidebar />
            <main className="min-h-[calc(100vh-3.5rem)] flex-1 px-4 py-8">{children}</main>
          </>
        ) : (
          <main className="mx-auto w-full max-w-2xl px-4 py-16">
            <NoPermission title={t('noPermission.title')} description={t('noPermission.description')} />
          </main>
        )}
      </div>
    </div>
  );
}
