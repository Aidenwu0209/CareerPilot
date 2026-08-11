import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Network, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
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
  const [{ locale, code }, t, context] = await Promise.all([
    params,
    getTranslations('career'),
    resolveServerContext(),
  ]);
  if (!context) return redirectToLogin(`/career/jobs/${code}`);

  const occupation = await getOccupationByCode(code);
  if (!occupation) notFound();

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
          <Button asChild className="w-full bg-brand hover:bg-brand-hover sm:w-auto">
            <Link href={`/career/matching?occupationCode=${encodeURIComponent(occupation.code)}`}>
              {t('jobDetail.matchAction')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusPill>{t('jobDetail.code', { code: occupation.code })}</StatusPill>
        <StatusPill tone="positive">{t('jobDetail.entryLevel', { level: occupation.entryLevel })}</StatusPill>
        {occupation.matchScore === null ? (
          <StatusPill tone="warning">{t('common.insufficientEvidence')}</StatusPill>
        ) : (
          <StatusPill tone="positive">{t('jobs.matchScore', { score: occupation.matchScore })}</StatusPill>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <CareerSection title={t('jobDetail.requirements.title')} description={t('jobDetail.requirements.description')}>
          <div className="space-y-5">
            {occupation.requirements.map((requirement) => (
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
            ))}
          </div>
        </CareerSection>

        <div className="space-y-6">
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
