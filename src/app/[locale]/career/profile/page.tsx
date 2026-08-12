import { CircleHelp, FileText, History, ShieldCheck, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerOverview, getCareerProfile } from '@/lib/career/service';
import {
  CareerMetricCard,
  CareerPageHeader,
  EvidenceBadge,
  ScoreBar,
  StatusPill,
} from '@/components/career/career-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialSyncButton } from '@/components/career/material-sync-button';

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default async function CareerProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, t, context] = await Promise.all([
    params,
    getTranslations('career'),
    resolveServerContext(),
  ]);
  if (!context) return redirectToLogin('/career/profile');

  const [profile, overview] = await Promise.all([
    getCareerProfile(context.actor.userId),
    getCareerOverview(context.actor.userId),
  ]);
  const evidenceTotal = profile.dimensions.reduce(
    (dimensionTotal, dimension) =>
      dimensionTotal + dimension.abilities.reduce((abilityTotal, ability) => abilityTotal + ability.evidenceCount, 0),
    0,
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('profile.eyebrow')}
        title={t('profile.title')}
        description={t('profile.description')}
        action={<MaterialSyncButton />}
      />

      <Card className="gap-5 overflow-hidden border-brand/20 bg-gradient-to-br from-brand/10 via-white to-white py-6 shadow-none dark:via-zinc-950 dark:to-zinc-950">
        <CardHeader className="px-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="positive">{t(`stage.${profile.stage}`)}</StatusPill>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('profile.updated', { date: formatDate(profile.updatedAt, locale, t('common.notSet')) })}
                </span>
              </div>
              <CardTitle className="mt-3 text-xl sm:text-2xl">{profile.headline || t('profile.defaultHeadline')}</CardTitle>
              <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
                {profile.summary || t('profile.defaultSummary')}
              </CardDescription>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </span>
          </div>
        </CardHeader>
      </Card>

      <section aria-label={t('profile.qualityLabel')} className="grid gap-3 sm:grid-cols-3">
        <CareerMetricCard
          label={t('metrics.profileCompleteness')}
          value={profile.completeness}
          suffix="%"
          description={t('metrics.profileCompletenessDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={ShieldCheck}
        />
        <CareerMetricCard
          label={t('metrics.evidenceCoverage')}
          value={profile.evidenceCoverage}
          suffix="%"
          description={t('metrics.evidenceCoverageDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={FileText}
        />
        <CareerMetricCard
          label={t('profile.evidenceTotal')}
          value={evidenceTotal}
          description={t('profile.evidenceTotalDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={History}
        />
      </section>

      <section aria-labelledby="profile-dimensions-title" className="space-y-4">
        <div>
          <h2 id="profile-dimensions-title" className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {t('profile.dimensions.title')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {t('profile.dimensions.description')}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {profile.dimensions.map((dimension) => (
            <Card key={dimension.code} className="gap-5 py-5 shadow-none">
              <CardHeader className="px-5 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{dimension.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {t('profile.dimensions.abilityCount', { count: dimension.abilities.length })}
                    </CardDescription>
                  </div>
                  <span className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                    {dimension.score === null ? t('common.unknown') : `${dimension.score}%`}
                  </span>
                </div>
                <div className="mt-2">
                  <ScoreBar
                    label={t('profile.dimensions.dimensionScore', { name: dimension.name })}
                    value={dimension.score}
                    unknownLabel={t('common.insufficientEvidence')}
                  />
                </div>
              </CardHeader>

              <CardContent className="space-y-3 px-5 sm:px-6">
                {dimension.abilities.length > 0 ? (
                  dimension.abilities.map((ability) => (
                    <details
                      key={ability.code}
                      className="group rounded-lg border border-zinc-200 bg-white open:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:open:bg-zinc-900"
                    >
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{ability.name}</p>
                          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {t('profile.abilities.evidenceCount', { count: ability.evidenceCount })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {ability.status === 'known' ? (
                            <StatusPill tone="positive">{ability.score}%</StatusPill>
                          ) : (
                            <StatusPill tone="warning">{t('common.insufficientEvidence')}</StatusPill>
                          )}
                          <span className="text-zinc-400 transition-transform group-open:rotate-45" aria-hidden="true">
                            +
                          </span>
                        </div>
                      </summary>

                      <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                        <div className="mb-3 flex flex-wrap gap-2 text-xs">
                          <EvidenceBadge>
                            {t('profile.abilities.confidence', {
                              value: ability.confidence === null ? t('common.unknown') : `${ability.confidence}%`,
                            })}
                          </EvidenceBadge>
                          <StatusPill>{t('profile.abilities.updated', { date: formatDate(ability.updatedAt, locale, t('common.notSet')) })}</StatusPill>
                        </div>
                        {ability.evidence.length > 0 ? (
                          <ul className="space-y-2">
                            {ability.evidence.map((evidence) => (
                              <li key={evidence.id} className="rounded-md bg-white p-3 text-sm dark:bg-zinc-950">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-medium text-zinc-800 dark:text-zinc-200">{evidence.title}</p>
                                  <StatusPill tone={evidence.status === 'verified' ? 'positive' : evidence.status === 'pending' ? 'warning' : 'neutral'}>
                                    {t(`evidenceStatus.${evidence.status}`)}
                                  </StatusPill>
                                </div>
                                <p className="mt-1 leading-5 text-zinc-500 dark:text-zinc-400">{evidence.excerpt}</p>
                                <p className="mt-2 text-xs text-zinc-400">
                                  {t(`evidenceSource.${evidence.sourceType}`)} ·{' '}
                                  {formatDate(evidence.occurredAt ?? evidence.createdAt, locale, t('common.notSet'))}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="flex items-start gap-2 rounded-md bg-white p-3 text-sm leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                            <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            {t('profile.abilities.noEvidence')}
                          </div>
                        )}
                      </div>
                    </details>
                  ))
                ) : (
                  <p className="rounded-lg bg-zinc-50 p-4 text-sm leading-6 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    {t('profile.dimensions.noAbilities')}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="profile-changes-title" className="space-y-3">
        <div>
          <h2 id="profile-changes-title" className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {t('profile.changes.title')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('profile.changes.description')}</p>
        </div>
        <Card className="gap-0 py-0 shadow-none">
          <CardContent className="p-5 sm:p-6">
            {overview.abilityChanges.length > 0 ? (
              <ol className="relative space-y-0 before:absolute before:bottom-3 before:left-[0.6875rem] before:top-3 before:w-px before:bg-zinc-200 dark:before:bg-zinc-800">
                {overview.abilityChanges.map((change) => (
                  <li key={`${change.abilityCode}-${change.changedAt}`} className="relative flex gap-4 pb-6 last:pb-0">
                    <span className="relative z-10 mt-1 h-5 w-5 shrink-0 rounded-full border-4 border-white bg-brand dark:border-zinc-950" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-zinc-800 dark:text-zinc-200">{change.abilityName}</p>
                        <span className="text-xs text-zinc-400">
                          {formatDate(change.changedAt, locale, t('common.notSet'))}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{change.reason}</p>
                      <p className="mt-1 text-xs font-medium tabular-nums text-brand">
                        {change.fromScore === null || change.toScore === null
                          ? t('common.pendingReview')
                          : t('profile.changes.scoreChange', { from: change.fromScore, to: change.toScore })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('profile.changes.empty')}</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
