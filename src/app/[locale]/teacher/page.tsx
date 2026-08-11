import { getTranslations } from 'next-intl/server';
import { TeacherWorkQueue, type TeacherWorkQueueProps } from '@/components/teacher/teacher-work-queue';
import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveTeacherWorkspace } from '@/lib/career/teacher-service';

export default async function TeacherWorkbenchPage() {
  const [context, t] = await Promise.all([
    resolveServerContext(),
    getTranslations('teacherWorkbench'),
  ]);

  if (!context) return redirectToLogin('/teacher');
  const access = await resolveTeacherWorkspace(context.actor.userId);
  if (access.status !== 'ready') return null;

  return (
    <div className="min-w-0 space-y-8">
      <header>
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('queue.eyebrow')}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
          {t('queue.pageTitle')}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t('queue.pageDescription')}
        </p>
      </header>
      <TeacherWorkQueue
        workspace={access.view}
        copy={t.raw('queue.content') as TeacherWorkQueueProps['copy']}
      />
    </div>
  );
}
