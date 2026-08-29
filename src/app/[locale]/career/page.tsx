import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Compass,
  Crosshair,
  FileCheck2,
  Gauge,
  Route,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerOverview, getCareerPath } from '@/lib/career/service';
import { getCareerSelfAssessment } from '@/lib/career/self-assessment-service';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  CareerMetricCard,
  CareerPageHeader,
  CareerSection,
  ScoreBar,
  StatusPill,
} from '@/components/career/career-shell';
import { CareerReportExport } from '@/components/career/career-report-export';
import { CareerGrowthProgress } from '@/components/career/career-growth-progress';
import { getGrowthProgress } from '@/lib/career/growth-service';
import { getLatestAnalysisRun } from '@/lib/career/analysis-pipeline';
import { AnalysisPipelineCard } from '@/components/career/analysis-pipeline-card';

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
}

export default async function CareerOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, context] = await Promise.all([
    params,
    resolveServerContext(),
  ]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career' });
  if (!context) return redirectToLogin('/career');

  const [overview, path, assessment, growth, latestRun] = await Promise.all([
    getCareerOverview(context.actor.userId),
    getCareerPath(context.actor.userId),
    getCareerSelfAssessment(context.actor.userId),
    getGrowthProgress(context.actor.userId),
    getLatestAnalysisRun(context.actor.userId),
  ]);
  const currentStage = path.stages[path.currentStageIndex] ?? null;
  const knownDimensions = overview.profile.dimensions.filter((dimension) => dimension.score !== null);

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('overview.eyebrow')}
        title={t('overview.title')}
        description={t('overview.description')}
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <CareerReportExport />
            <Button asChild className="w-full bg-brand hover:bg-brand-hover sm:w-auto">
              <Link href={overview.primaryGoal ? '/career/matching' : '/career/goals'}>
                {overview.primaryGoal ? t('overview.viewMatch') : t('overview.chooseGoal')}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="gap-0 border-brand/20 bg-brand/5 py-0 shadow-none">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">{t('overview.resume.eyebrow')}</p>
            <h2 className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">
              {!assessment?.completedAt ? t('overview.resume.assessmentTitle') : !overview.primaryGoal ? t('overview.resume.goalTitle') : overview.nextTasks[0] ? t('overview.resume.taskTitle') : t('overview.resume.matchTitle')}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {!assessment?.completedAt ? t('overview.resume.assessmentDescription') : !overview.primaryGoal ? t('overview.resume.goalDescription') : overview.nextTasks[0]?.title ?? t('overview.resume.matchDescription')}
            </p>
          </div>
          <Button asChild className="w-full shrink-0 sm:w-auto">
            <Link href={!assessment?.completedAt ? '/career/assessment' : !overview.primaryGoal ? '/career/goals' : overview.nextTasks[0] ? '/career/path' : '/career/matching'}>
              {t('overview.resume.action')}<ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {!overview.primaryGoal ? (
        <Card className="gap-0 border-brand/20 bg-gradient-to-br from-brand/10 via-white to-white py-0 shadow-none dark:via-zinc-950 dark:to-zinc-950">
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white">
                <Compass className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">{t('overview.noGoal.title')}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {t('overview.noGoal.description')}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="w-full shrink-0 bg-white dark:bg-zinc-950 sm:w-auto">
              <Link href="/career/goals">{t('overview.noGoal.action')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden border-brand/20 bg-zinc-950 py-0 text-white shadow-none dark:bg-zinc-900">
          <CardContent className="grid gap-6 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-7">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="positive">{t('overview.primaryGoal')}</StatusPill>
                <span className="text-xs text-zinc-400">
                  {t('overview.targetDate', {
                    date: formatDate(overview.primaryGoal.targetDate, locale, t('common.notSet')),
                  })}
                </span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">{overview.primaryGoal.occupationName}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
                {overview.primaryGoal.rationale || t('overview.goalFallback')}
              </p>
            </div>
            <Button asChild variant="secondary" className="w-full sm:w-auto">
              <Link href="/career/goals">{t('overview.manageGoal')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section aria-label={t('overview.indicatorsLabel')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CareerMetricCard
          label={t('metrics.readiness')}
          value={overview.indicators.readiness}
          suffix="%"
          description={t('metrics.readinessDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={Gauge}
        />
        <CareerMetricCard
          label={t('metrics.match')}
          value={overview.indicators.match}
          suffix="%"
          description={t('metrics.matchDescription')}
          unknownLabel={overview.primaryGoal ? t('common.insufficientEvidence') : t('common.goalRequired')}
          icon={Crosshair}
        />
        <CareerMetricCard
          label={t('metrics.profileCompleteness')}
          value={overview.indicators.profileCompleteness}
          suffix="%"
          description={t('metrics.profileCompletenessDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={UserRoundCheck}
        />
        <CareerMetricCard
          label={t('metrics.evidenceCoverage')}
          value={overview.indicators.evidenceCoverage}
          suffix="%"
          description={t('metrics.evidenceCoverageDescription')}
          unknownLabel={t('common.insufficientEvidence')}
          icon={FileCheck2}
        />
      </section>

      <CareerGrowthProgress initial={growth} locale={locale} />

      <AnalysisPipelineCard initialRun={latestRun} locale={locale} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
        <CareerSection
          title={t('overview.abilities.title')}
          description={t('overview.abilities.description', {
            known: knownDimensions.length,
            total: overview.profile.dimensions.length,
          })}
          href="/career/profile"
          actionLabel={t('common.viewDetails')}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {overview.profile.dimensions.map((dimension) => (
              <ScoreBar
                key={dimension.code}
                label={dimension.name}
                value={dimension.score}
                unknownLabel={t('common.insufficientEvidence')}
                detail={t('overview.abilities.evidenceCount', {
                  count: dimension.abilities.reduce((sum, ability) => sum + ability.evidenceCount, 0),
                })}
              />
            ))}
          </div>
        </CareerSection>

        <CareerSection
          title={t('overview.milestone.title')}
          description={overview.primaryGoal?.occupationName ?? t('overview.milestone.noGoal')}
          href="/career/path"
          actionLabel={t('common.viewPath')}
        >
          {currentStage ? (
            <div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Route className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{currentStage.title}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{currentStage.description}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                {currentStage.targetDate
                  ? t('overview.milestone.due', {
                      date: formatDate(currentStage.targetDate, locale, t('common.notSet')),
                    })
                  : t('overview.milestone.noDate')}
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('overview.milestone.empty')}</p>
          )}
        </CareerSection>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CareerSection
          title={t('overview.tasks.title')}
          description={t('overview.tasks.description')}
          href="/career/path"
          actionLabel={t('common.viewAll')}
        >
          {overview.nextTasks.length > 0 ? (
            <ol className="space-y-3">
              {overview.nextTasks.slice(0, 4).map((task) => (
                <li key={task.id} className="flex gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <span className="mt-0.5 text-brand">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{task.title}</p>
                      <StatusPill tone={task.status === 'completed' ? 'positive' : 'neutral'}>
                        {t(`taskStatus.${task.status}`)}
                      </StatusPill>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500 dark:text-zinc-400">
                      {task.description}
                    </p>
                    {task.dueAt ? (
                      <p className="mt-2 text-xs text-zinc-400">
                        {t('overview.tasks.due', { date: formatDate(task.dueAt, locale, t('common.notSet')) })}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="py-6 text-center">
              <BookOpenCheck className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('overview.tasks.empty')}</p>
            </div>
          )}
        </CareerSection>

        <CareerSection
          title={t('overview.changes.title')}
          description={t('overview.changes.description')}
          href="/career/profile"
          actionLabel={t('common.viewAll')}
        >
          {overview.abilityChanges.length > 0 ? (
            <ol className="space-y-4">
              {overview.abilityChanges.slice(0, 4).map((change) => (
                <li key={`${change.abilityCode}-${change.changedAt}`} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 border-b border-zinc-100 pb-4 last:border-0 dark:border-zinc-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{change.abilityName}</p>
                      <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">
                        {change.delta === null ? t('common.pendingReview') : `${change.delta > 0 ? '+' : ''}${change.delta}`}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-zinc-500 dark:text-zinc-400">{change.reason}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="py-6 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('overview.changes.empty')}</p>
            </div>
          )}
        </CareerSection>
      </div>

      <CareerSection title={t('overview.guidance.title')} description={t('overview.guidance.description')}>
        {overview.latestGuidance.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {overview.latestGuidance.map((note) => (
              <blockquote key={note.id} className="rounded-lg border-l-4 border-brand bg-brand/5 px-4 py-3 dark:bg-brand/10">
                <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{note.content}</p>
                <footer className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {note.teacherName} · {formatDate(note.createdAt, locale, t('common.notSet'))}
                </footer>
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('overview.guidance.empty')}</p>
        )}
      </CareerSection>
    </div>
  );
}
