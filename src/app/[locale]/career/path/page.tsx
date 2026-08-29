import { CalendarClock, CheckCircle2, CircleDashed, Crosshair, Flag, LockKeyhole, Route } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerPath } from '@/lib/career/service';
import { Link } from '@/i18n/routing';
import { CareerPageHeader, EmptyCareerState, StatusPill } from '@/components/career/career-shell';
import { TaskStatusButton } from '@/components/career/task-status-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getCareerAccess } from '@/lib/career/growth-service';
import { CareerFeatureUnlock } from '@/components/career/career-feature-unlock';

function formatDate(value: string | null, locale: string, fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export default async function CareerPathPage({
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
  if (!context) return redirectToLogin('/career/path');

  const [path, access] = await Promise.all([getCareerPath(context.actor.userId), getCareerAccess(context.actor.userId)]);
  const fullPathUnlocked = access.features.full_path.unlocked;
  const visibleStages = fullPathUnlocked ? path.stages : path.stages.slice(0, 1);

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('path.eyebrow')}
        title={t('path.title')}
        description={t('path.description')}
        action={
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/career/goals">
              <Crosshair className="h-4 w-4" aria-hidden="true" />
              {t('path.manageGoal')}
            </Link>
          </Button>
        }
      />

      {!path.goal ? (
        <EmptyCareerState
          icon={Route}
          title={t('path.empty.title')}
          description={t('path.empty.description')}
          href="/career/goals"
          actionLabel={t('path.empty.action')}
        />
      ) : (
        <>
          <Card className="gap-0 border-brand/20 bg-gradient-to-br from-brand/10 via-white to-white py-0 shadow-none dark:via-zinc-950 dark:to-zinc-950">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
                  <Flag className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-brand">{t('path.goalLabel')}</p>
                  <h2 className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{path.goal.occupationName}</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {t('path.targetDate', { date: formatDate(path.goal.targetDate, locale, t('common.notSet')) })}
                  </p>
                </div>
              </div>
              <StatusPill tone="positive">
                {t('path.stageProgress', {
                  current: Math.min(path.currentStageIndex + 1, path.stages.length),
                  total: path.stages.length,
                })}
              </StatusPill>
            </CardContent>
          </Card>

          <section aria-label={t('path.timelineLabel')} className="space-y-4">
            {visibleStages.map((stage, index) => {
              const StageIcon = stage.status === 'completed' ? CheckCircle2 : stage.status === 'locked' ? LockKeyhole : CircleDashed;
              return (
                <article key={stage.id} className="relative grid gap-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <div className="hidden flex-col items-center sm:flex">
                    <span
                      className={cn(
                        'relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-zinc-50 dark:border-background',
                        stage.status === 'completed' && 'bg-emerald-500 text-white',
                        stage.status === 'current' && 'bg-brand text-white',
                        stage.status === 'locked' && 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                      )}
                    >
                      <StageIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {index < path.stages.length - 1 ? (
                      <span className="-mb-4 min-h-10 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                    ) : null}
                  </div>

                  <Card
                    className={cn(
                      'gap-5 py-5 shadow-none',
                      stage.status === 'current' && 'border-brand/30 ring-1 ring-brand/10',
                      stage.status === 'locked' && 'bg-zinc-50/70 dark:bg-zinc-950/60',
                    )}
                  >
                    <CardHeader className="px-5 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:hidden',
                              stage.status === 'completed' && 'bg-emerald-500 text-white',
                              stage.status === 'current' && 'bg-brand text-white',
                              stage.status === 'locked' && 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800',
                            )}
                          >
                            <StageIcon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-lg">{stage.title}</CardTitle>
                              <StatusPill tone={stage.status === 'completed' ? 'positive' : stage.status === 'current' ? 'warning' : 'neutral'}>
                                {t(`pathStageStatus.${stage.status}`)}
                              </StatusPill>
                            </div>
                            <CardDescription className="mt-1 max-w-3xl leading-6">{stage.description}</CardDescription>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <CalendarClock className="h-4 w-4" aria-hidden="true" />
                          {formatDate(stage.targetDate, locale, t('common.notSet'))}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="px-5 sm:px-6">
                      {stage.tasks.length > 0 ? (
                        <div className="space-y-3">
                          {stage.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium text-zinc-800 dark:text-zinc-200">{task.title}</p>
                                  <StatusPill tone={task.status === 'completed' ? 'positive' : task.status === 'in_progress' ? 'warning' : 'neutral'}>
                                    {t(`taskStatus.${task.status}`)}
                                  </StatusPill>
                                  <StatusPill>{t(`taskCategory.${task.category}`)}</StatusPill>
                                </div>
                                <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{task.description}</p>
                                {task.dueAt ? (
                                  <p className="mt-1 text-xs text-zinc-400">
                                    {t('path.taskDue', { date: formatDate(task.dueAt, locale, t('common.notSet')) })}
                                  </p>
                                ) : null}
                              </div>
                              {stage.status !== 'locked' ? (
                                <div className="shrink-0">
                                  <TaskStatusButton taskId={task.id} currentStatus={task.status} />
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('path.noTasks')}</p>
                      )}
                    </CardContent>
                  </Card>
                </article>
              );
            })}
          </section>
          {!fullPathUnlocked && path.stages.length > 1 ? <CareerFeatureUnlock
            feature="full_path"
            priceCredits={access.features.full_path.priceCredits}
            title={locale === 'zh' ? `解锁后续 ${path.stages.length - 1} 个成长阶段` : `Unlock ${path.stages.length - 1} more growth stages`}
            description={locale === 'zh' ? '首阶段可免费执行；一次解锁完整时间线、阶段任务和持续进度。订阅用户自动解锁。' : 'The first stage is free. Unlock the complete timeline, tasks, and ongoing progress. Subscribers are unlocked automatically.'}
          /> : null}
        </>
      )}
    </div>
  );
}
