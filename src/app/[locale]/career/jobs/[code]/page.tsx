import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  ExternalLink,
  GraduationCap,
  MapPin,
  Network,
  ShieldCheck,
  Tags,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getOccupationByCode } from '@/lib/career/service';
import { Link } from '@/i18n/routing';
import { CareerPageHeader, CareerSection, ScoreBar, StatusPill } from '@/components/career/career-shell';
import { Button } from '@/components/ui/button';

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default async function OccupationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const [{ locale, code }, context] = await Promise.all([
    params,
    resolveServerContext(),
  ]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career' });
  if (!context) return redirectToLogin(`/career/jobs/${code}`);

  const occupation = await getOccupationByCode(code);
  if (!occupation) notFound();
  const sourceVersion = (occupation as typeof occupation & { sourceVersion?: string | null }).sourceVersion;
  const isMatchEligible = occupation.scoringEligible !== false && occupation.requirements.length > 0;
  const effectiveReviewStatus = isMatchEligible
    && ['reviewed', 'approved'].includes(occupation.reviewStatus ?? '')
    ? 'reviewed'
    : 'review_required';

  return (
    <div className="space-y-6 sm:space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ml-3 w-fit">
        <Link href="/career/jobs">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('jobDetail.back')}
        </Link>
      </Button>

      <CareerPageHeader
        eyebrow={occupation.category}
        title={occupation.name}
        description={occupation.description}
        action={
          isMatchEligible ? (
            <Button asChild className="w-full bg-brand hover:bg-brand-hover sm:w-auto">
              <Link href={`/career/matching?occupationCode=${encodeURIComponent(occupation.code)}`}>
                {t('jobDetail.matchAction')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled className="w-full sm:w-auto">{t('jobDetail.matchUnavailable')}</Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusPill>{t('jobDetail.code', { code: occupation.code })}</StatusPill>
        {occupation.canonicalType === 'china_national_occupation' && isMatchEligible ? (
          <StatusPill tone="positive">{t('jobDetail.standardOccupation')}</StatusPill>
        ) : null}
        <StatusPill tone="positive">{t('jobDetail.entryLevel', { level: occupation.entryLevel })}</StatusPill>
        {occupation.jobFamily ? <StatusPill>{t('jobDetail.jobFamily', { value: occupation.jobFamily })}</StatusPill> : null}
        {occupation.industry ? <StatusPill>{t('jobDetail.industry', { value: occupation.industry })}</StatusPill> : null}
        {occupation.catalogVersion ? <StatusPill>{t('jobDetail.catalogVersion', { value: occupation.catalogVersion })}</StatusPill> : null}
        {!isMatchEligible ? (
          <StatusPill tone="warning">{t('common.knowledgePendingReview')}</StatusPill>
        ) : occupation.matchScore === null ? (
          <StatusPill tone="warning">{t('common.notScored')}</StatusPill>
        ) : (
          <StatusPill tone="positive">{t('jobs.matchScore', { score: occupation.matchScore })}</StatusPill>
        )}
      </div>

      {!isMatchEligible ? (
        <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{t('jobDetail.reviewRequired.title')}</p>
          <p className="mt-1">{t('jobDetail.reviewRequired.description')}</p>
        </div>
      ) : null}

      {(occupation.cities?.length || occupation.educationLevels?.length || occupation.aliases?.length) ? (
        <section aria-label={t('jobDetail.metadataLabel')} className="grid gap-3 sm:grid-cols-3">
          {occupation.cities?.length ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"><MapPin className="h-4 w-4" aria-hidden="true" />{t('jobDetail.cities')}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">{occupation.cities.join(t('jobs.separator'))}</p>
            </div>
          ) : null}
          {occupation.educationLevels?.length ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"><GraduationCap className="h-4 w-4" aria-hidden="true" />{t('jobDetail.educationLevels')}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">{occupation.educationLevels.join(t('jobs.separator'))}</p>
            </div>
          ) : null}
          {occupation.aliases?.length ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"><Tags className="h-4 w-4" aria-hidden="true" />{t('jobDetail.aliases')}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">{occupation.aliases.join(t('jobs.separator'))}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <CareerSection title={t('jobDetail.requirements.title')} description={t('jobDetail.requirements.description')}>
          <div className="space-y-5">
            {occupation.requirements.length > 0 ? occupation.requirements.map((requirement) => (
              <div key={requirement.abilityCode} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{requirement.abilityName}</h3>
                      {requirement.required ? (
                        <StatusPill tone="warning">{t('jobDetail.requirements.required')}</StatusPill>
                      ) : (
                        <StatusPill>{t('jobDetail.requirements.preferred')}</StatusPill>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{requirement.description}</p>
                  </div>
                </div>
                <ScoreBar
                  label={t('jobDetail.requirements.target', { name: requirement.abilityName })}
                  value={requirement.targetScore}
                  unknownLabel={t('common.unknown')}
                  detail={t('jobDetail.requirements.weight', { weight: requirement.weight })}
                />
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="font-medium text-zinc-800 dark:text-zinc-200">{t('jobDetail.requirements.emptyTitle')}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('jobDetail.requirements.emptyDescription')}</p>
              </div>
            )}
          </div>
        </CareerSection>

        <div className="space-y-6">
          <CareerSection title={t('jobDetail.majors.title')} description={t('jobDetail.majors.description')}>
            {occupation.majorMappings?.length ? (
              <ul className="space-y-3">
                {occupation.majorMappings.map((mapping) => (
                  <li key={`${mapping.majorCode}-${mapping.relevanceType}`} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-zinc-800 dark:text-zinc-200">{mapping.majorName}</p>
                          <StatusPill>{t(`relevanceType.${mapping.relevanceType}`)}</StatusPill>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{mapping.collegeName} · {mapping.majorCode}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('jobDetail.majors.empty')}</p>}
          </CareerSection>

          <CareerSection title={t('jobDetail.graph.title')} description={t('jobDetail.graph.description')}>
            {occupation.relatedOccupations.length > 0 ? (
              <ul className="space-y-3">
                {occupation.relatedOccupations.map((related) => (
                  <li key={`${related.relationType}-${related.code}`}>
                    <Link
                      href={`/career/jobs/${related.code}`}
                      className="group block rounded-lg border border-zinc-200 p-3 transition-colors hover:border-brand/30 hover:bg-brand/5 dark:border-zinc-800 dark:hover:bg-brand/10"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">{related.name}</span>
                            <StatusPill>{t(`relationType.${related.relationType}`)}</StatusPill>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{related.description}</p>
                        </div>
                        <Network className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-brand" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('jobDetail.graph.empty')}</p>
            )}
          </CareerSection>

          <CareerSection title={t('jobDetail.sources.title')} description={t('jobDetail.sources.description')}>
            {occupation.canonicalType === 'china_national_occupation' ? (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                <p className="font-medium">{t('jobDetail.sources.standardTitle')}</p>
                <p className="mt-1 text-xs">{t('jobDetail.sources.standardDescription')}</p>
              </div>
            ) : null}
            {(sourceVersion || occupation.reviewStatus || !isMatchEligible) ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {sourceVersion ? <StatusPill>{t('jobDetail.sources.sourceVersion', { version: sourceVersion })}</StatusPill> : null}
                {(occupation.reviewStatus || !isMatchEligible) ? (
                  <StatusPill tone={effectiveReviewStatus === 'reviewed' ? 'positive' : 'warning'}>
                    {t(`reviewStatus.${effectiveReviewStatus}`)}
                  </StatusPill>
                ) : null}
              </div>
            ) : null}
            {occupation.citations.length > 0 ? (
              <ol className="space-y-3">
                {occupation.citations.map((citation) => (
                  <li key={citation.id} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                    <div className="flex items-start gap-3">
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                      <div className="min-w-0">
                        <a
                          href={citation.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-zinc-800 hover:text-brand dark:text-zinc-200"
                        >
                          {citation.title}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{citation.excerpt}</p>
                        <p className="mt-2 flex items-center gap-1 text-xs text-zinc-400">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {citation.sourceLabel} · {t('jobDetail.sources.verified', {
                            date: formatDate(citation.verifiedAt, locale, t('common.notSet')),
                          })}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('jobDetail.sources.empty')}</p>
            )}
          </CareerSection>
        </div>
      </div>
    </div>
  );
}
