import { CalendarDays, CheckCircle2, Compass, ShieldQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerOverview, listOccupations } from '@/lib/career/service';
import { Link } from '@/i18n/routing';
import { GoalForm } from '@/components/career/goal-form';
import { CareerPageHeader, StatusPill } from '@/components/career/career-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(value),
  );
}

export default async function CareerGoalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, t, context] = await Promise.all([
    params,
    getTranslations('career'),
    resolveServerContext(),
  ]);
  if (!context) return redirectToLogin('/career/goals');

  const [overview, occupations] = await Promise.all([
    getCareerOverview(context.actor.userId),
    listOccupations(),
  ]);
  const goal = overview.primaryGoal;

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('goals.eyebrow')}
        title={t('goals.title')}
        description={t('goals.description')}
        action={
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/career/jobs">
              <Compass className="h-4 w-4" aria-hidden="true" />
              {t('goals.exploreJobs')}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Card className="self-start gap-5 py-6 shadow-none">
          <CardHeader className="px-5 sm:px-6">
            <CardTitle className="text-lg">{t('goals.current.title')}</CardTitle>
            <CardDescription>{t('goals.current.description')}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 sm:px-6">
            {goal ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="positive">{t('goals.current.primary')}</StatusPill>
                  <StatusPill
                    tone={goal.teacherConfirmationStatus === 'confirmed' ? 'positive' : goal.teacherConfirmationStatus === 'needs_revision' ? 'warning' : 'neutral'}
                  >
                    {t(`teacherConfirmation.${goal.teacherConfirmationStatus}`)}
                  </StatusPill>
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {goal.occupationName}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {goal.rationale || t('goals.current.noRationale')}
                </p>

                <dl className="mt-5 space-y-3 border-t border-zinc-100 pt-5 text-sm dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      {t('goals.current.targetDate')}
                    </dt>
                    <dd className="font-medium text-zinc-800 dark:text-zinc-200">
                      {formatDate(goal.targetDate, locale, t('common.notSet'))}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {t('goals.current.status')}
                    </dt>
                    <dd className="font-medium text-zinc-800 dark:text-zinc-200">{t(`goalStatus.${goal.status}`)}</dd>
                  </div>
                </dl>

                <div className="mt-5 space-y-3">
                  {(['industries', 'cities', 'organizationTypes'] as const).map((key) => {
                    const values = goal.preferences[key] ?? [];
                    return values.length > 0 ? (
                      <div key={key}>
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(`goals.current.${key}`)}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {values.map((value) => <StatusPill key={value}>{value}</StatusPill>)}
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                  <ShieldQuestion className="h-6 w-6" aria-hidden="true" />
                </span>
                <h2 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">{t('goals.current.emptyTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('goals.current.emptyDescription')}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-5 py-6 shadow-none">
          <CardHeader className="px-5 sm:px-6">
            <CardTitle className="text-lg">{goal ? t('goals.form.editTitle') : t('goals.form.title')}</CardTitle>
            <CardDescription>{t('goals.form.description')}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 sm:px-6">
            {occupations.length > 0 ? (
              <GoalForm occupations={occupations} currentGoal={goal} />
            ) : (
              <p className="rounded-lg bg-zinc-50 p-4 text-sm leading-6 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {t('goals.form.noOccupations')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
