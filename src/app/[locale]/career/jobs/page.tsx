import { ArrowRight, BriefcaseBusiness, Search } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { listOccupations } from '@/lib/career/service';
import { Link } from '@/i18n/routing';
import { CareerPageHeader, EmptyCareerState, StatusPill } from '@/components/career/career-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default async function CareerJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [query, t, context] = await Promise.all([
    searchParams.then((value) => (typeof value.q === 'string' ? value.q.trim() : '')),
    getTranslations('career'),
    resolveServerContext(),
  ]);
  if (!context) return redirectToLogin('/career/jobs');

  const occupations = await listOccupations(query || undefined);

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('jobs.eyebrow')}
        title={t('jobs.title')}
        description={t('jobs.description')}
      />

      <form method="get" action="" role="search" className="flex max-w-2xl flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t('jobs.searchPlaceholder')}
            aria-label={t('jobs.searchLabel')}
            className="h-10 bg-white pl-9 dark:bg-zinc-950"
          />
        </div>
        <Button type="submit" className="bg-brand hover:bg-brand-hover">{t('jobs.searchAction')}</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {query
            ? t('jobs.resultFor', { query, count: occupations.length })
            : t('jobs.resultCount', { count: occupations.length })}
        </p>
        {query ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/career/jobs">{t('jobs.clearSearch')}</Link>
          </Button>
        ) : null}
      </div>

      {occupations.length > 0 ? (
        <section aria-label={t('jobs.listLabel')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {occupations.map((occupation) => (
            <Card key={occupation.code} className="group gap-5 py-5 shadow-none transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
              <CardHeader className="px-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {occupation.matchScore === null ? (
                    <StatusPill>{t('common.insufficientEvidence')}</StatusPill>
                  ) : (
                    <StatusPill tone="positive">{t('jobs.matchScore', { score: occupation.matchScore })}</StatusPill>
                  )}
                </div>
                <div className="mt-1">
                  <CardTitle className="text-lg">{occupation.name}</CardTitle>
                  <CardDescription className="mt-1">{occupation.category}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col px-5">
                <p className="line-clamp-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{occupation.summary}</p>
                <Button asChild variant="ghost" className="-ml-3 mt-4 w-fit text-brand hover:text-brand">
                  <Link href={`/career/jobs/${occupation.code}`}>
                    {t('jobs.viewOccupation')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : (
        <EmptyCareerState
          icon={Search}
          title={t('jobs.empty.title')}
          description={t('jobs.empty.description')}
          href="/career/jobs"
          actionLabel={t('jobs.clearSearch')}
        />
      )}
    </div>
  );
}
