import { getTranslations } from 'next-intl/server';
import { resolveContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { organizations, organizationMemberships, creditAccounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Link } from '@/i18n/routing';
import { Users, BarChart3 } from 'lucide-react';

export default async function OrgAdminPage() {
  const t = await getTranslations('orgAdmin');
  const context = await resolveContext();

  const userId = context!.actor.userId;

  const orgInfo = await db
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

  const org = orgInfo[0];

  // Get active member count
  const memberCount = await db
    .select({ count: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, org.orgId),
        eq(organizationMemberships.status, 'active'),
      ),
    );

  const seatsUsed = memberCount.length;

  // Get org credit balance
  const creditAccount = await db
    .select({ balance: creditAccounts.balance })
    .from(creditAccounts)
    .where(
      and(
        eq(creditAccounts.ownerType, 'organization'),
        eq(creditAccounts.ownerId, org.orgId),
      ),
    )
    .limit(1);

  const creditBalance = creditAccount[0]?.balance ?? 0;
  const isActive = org.orgStatus === 'active';

  const cards = [
    { href: '/org-admin/members', icon: Users, title: t('sections.members.title'), description: t('sections.members.description') },
    { href: '/org-admin/usage', icon: BarChart3, title: t('sections.usage.title'), description: t('sections.usage.description') },
  ] as const;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('title')}
      </h1>

      {/* Org summary */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t('summary.orgName')}
            </dt>
            <dd className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {org.orgName}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t('summary.status')}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {isActive ? t('summary.statusActive') : t('summary.statusSuspended')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t('summary.seats')}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {seatsUsed} / {org.seatLimit}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t('summary.credits')}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {creditBalance.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Section cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Icon className="h-8 w-8 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
              <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
