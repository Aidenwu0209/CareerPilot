import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
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
import { ReconsentButton } from '@/components/account/reconsent-button';
import { Badge } from '@/components/ui/badge';
import { Building2, Shield, User, Calendar, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getAllCurrentVersions, getUserConsents, checkAllCurrentConsents } from '@/lib/legal/consent-service';
import { Link } from '@/i18n/routing';
import { getSchoolMembership } from '@/lib/organizations/school-service';
import { SchoolMembershipCard } from '@/components/account/school-membership-card';

export default async function AccountPage() {
  const t = await getTranslations('account');
  const context = await resolveServerContext();

  if (!context) {
    return redirectToLogin('/account');
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
    return redirectToLogin('/account');
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

  // Fetch legal consent data
  const currentVersions = getAllCurrentVersions();
  const userConsents = await getUserConsents(userId);
  const consentStatus = await checkAllCurrentConsents(userId);
  const schoolMembership = await getSchoolMembership(userId);

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
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8">
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

        <SchoolMembershipCard initialMembership={schoolMembership} />

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

        {/* Legal documents & consent section */}
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {t('legal.title')}
            </h2>
          </div>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t('legal.description')}
          </p>

          {/* Re-consent warning */}
          {!consentStatus.allConsented && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                    {t('legal.reconsentTitle')}
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    {t('legal.reconsentDescription')}
                  </p>
                  <div className="mt-3">
                    <ReconsentButton />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Up-to-date notice */}
          {consentStatus.allConsented && (
            <div className="mb-4 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              {t('legal.upToDate')}
            </div>
          )}

          {/* Document versions table */}
          <div className="space-y-4">
            {(['privacy_policy', 'terms_of_service'] as const).map((docType) => {
              const current = currentVersions[docType];
              const consent = userConsents[docType];
              const isCurrent = consent?.version === current.version;
              const docLabel = docType === 'privacy_policy' ? t('legal.privacyPolicy') : t('legal.termsOfService');
              const docHref = docType === 'privacy_policy' ? '/privacy' : '/terms';

              return (
                <div
                  key={docType}
                  className="rounded-lg border border-zinc-100 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {docLabel}
                        </p>
                        {isCurrent ? (
                          <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {t('legal.version', { version: current.version })}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            {t('legal.notConsented')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t('legal.effective')}: {formatDate(current.effectiveDate)}
                      </p>
                      {consent ? (
                        <div className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <p>
                            {t('legal.consentedAt')}: {formatDate(consent.createdAt)}
                          </p>
                          <p>
                            {t('legal.consentSource')}: {t(`legal.source.${consent.source}` as 'registration')}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <Link
                      href={docHref}
                      className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {t('legal.viewDocument')}
                    </Link>
                  </div>
                </div>
              );
            })}
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
