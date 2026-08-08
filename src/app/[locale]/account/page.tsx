import { redirect } from 'next/navigation';
import { resolveContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import {
  organizationMemberships,
  organizations,
  users,
  resumes,
  interviewSessions,
} from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { Header } from '@/components/layout/header';
import { ExportButton } from '@/components/account/export-button';
import { DeleteAccountSection } from '@/components/account/delete-account-section';
import { Badge } from '@/components/ui/badge';
import { Building2, Shield, User, Calendar } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function AccountPage() {
  const t = await getTranslations('account');
  const context = await resolveContext();

  if (!context) {
    redirect('/login?callbackUrl=/account');
    return;
  }

  const userId = context.actor.userId;

  // Fetch full user record
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];

  if (!user) {
    redirect('/login?callbackUrl=/account');
    return;
  }

  // Fetch org memberships
  const memberships = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgStatus: organizations.status,
      role: organizationMemberships.role,
      memberStatus: organizationMemberships.status,
      joinedAt: organizationMemberships.createdAt,
    })
    .from(organizationMemberships)
    .innerJoin(
      organizations,
      eq(organizationMemberships.organizationId, organizations.id),
    )
    .where(eq(organizationMemberships.userId, userId));

  const isSuperAdmin = context.actor.platformRole === 'super_admin';
  const isActive = context.actor.status === 'active';

  // Fetch counts for deletion summary
  const [resumeCountRow] = await db
    .select({ value: count() })
    .from(resumes)
    .where(eq(resumes.userId, userId));
  const [interviewCountRow] = await db
    .select({ value: count() })
    .from(interviewSessions)
    .where(eq(interviewSessions.userId, userId));

  const formatDate = (date: Date | string | null) => {
    if (!date) return '—';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {t('description')}
          </p>
        </div>

        {/* Profile card */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <User className="h-6 w-6 text-zinc-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {user.name || t('unnamed')}
              </h2>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {user.email || '—'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={isSuperAdmin ? 'default' : 'secondary'}>
                  {isSuperAdmin ? (
                    <>
                      <Shield className="mr-1 h-3 w-3" />
                      {t('role.superAdmin')}
                    </>
                  ) : (
                    <>
                      <User className="mr-1 h-3 w-3" />
                      {t('role.user')}
                    </>
                  )}
                </Badge>
                <Badge variant={isActive ? 'default' : 'destructive'}>
                  {isActive ? t('status.active') : t('status.suspended')}
                </Badge>
                <Badge variant="outline">
                  {user.authType === 'email'
                    ? t('authType.email')
                    : user.authType === 'oauth'
                      ? t('authType.oauth')
                      : t('authType.fingerprint')}
                </Badge>
              </div>
            </div>
          </div>

          {/* Detail fields */}
          <div className="mt-6 grid grid-cols-1 gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-zinc-400 dark:text-zinc-500">
                {t('field.userId')}
              </p>
              <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-300">
                {user.id}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-zinc-400 dark:text-zinc-500">
                {t('field.joined')}
              </p>
              <div className="mt-1 flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
                <Calendar className="h-3.5 w-3.5 text-zinc-400" />
                {formatDate(user.createdAt)}
              </div>
            </div>
          </div>
        </div>

        {/* Organization summary */}
        {memberships.length > 0 && (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-zinc-400" />
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {t('orgs.title')}
              </h2>
            </div>
            <div className="space-y-3">
              {memberships.map((m: typeof memberships[number]) => (
                <div
                  key={m.orgId}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 px-4 py-3 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {m.orgName}
                    </p>
                    <p className="font-mono text-xs text-zinc-400">
                      {m.orgSlug}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant={m.role === 'org_admin' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {m.role === 'org_admin'
                        ? t('orgs.roleAdmin')
                        : t('orgs.roleMember')}
                    </Badge>
                    <Badge
                      variant={
                        m.memberStatus === 'active' ? 'outline' : 'destructive'
                      }
                      className="text-xs"
                    >
                      {m.memberStatus === 'active'
                        ? t('orgs.statusActive')
                        : t('orgs.statusRemoved')}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Data export section */}
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t('export.title')}
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {t('export.description')}
          </p>
          <div className="mt-4">
            <ExportButton />
          </div>
        </div>

        {/* Danger zone: account deletion */}
        <DeleteAccountSection
          userEmail={user.email}
          hasMemberships={memberships.length > 0}
          orgNames={memberships.map((m: typeof memberships[number]) => m.orgName)}
          resumeCount={resumeCountRow?.value ?? 0}
          interviewCount={interviewCountRow?.value ?? 0}
        />
      </main>
    </div>
  );
}
