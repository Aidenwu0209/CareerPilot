import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { TeacherAccessState } from '@/components/teacher/teacher-access-state';
import { TeacherSidebar, type TeacherSidebarProps } from '@/components/teacher/teacher-sidebar';
import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveTeacherWorkspace } from '@/lib/career/teacher-service';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const [context, t] = await Promise.all([
    resolveServerContext(),
    getTranslations('teacherWorkbench'),
  ]);

  if (!context) return redirectToLogin('/teacher');

  const access = await resolveTeacherWorkspace(context.actor.userId);
  const navCopy = t.raw('nav') as TeacherSidebarProps['copy'];

  return (
    <div className="min-h-screen overflow-x-clip bg-zinc-50 dark:bg-background">
      <Header />
      {access.status === 'ready' ? (
        <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
          <TeacherSidebar copy={navCopy} />
          <main className="min-w-0 flex-1 px-4 py-7 sm:px-6 sm:py-8">{children}</main>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          <TeacherAccessState
            kind={access.status === 'unconfigured' ? 'unconfigured' : 'denied'}
            title={t(`access.${access.status}.title`)}
            description={t(`access.${access.status}.description`)}
            actionLabel={t('access.action')}
          />
        </main>
      )}
    </div>
  );
}
