import { getTranslations } from 'next-intl/server';
import { TeacherStudentList, type TeacherStudentListProps } from '@/components/teacher/teacher-student-list';
import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { listAssignedStudents, resolveTeacherWorkspace } from '@/lib/career/teacher-service';

interface TeacherStudentsPageProps {
  searchParams: Promise<{ status?: string; queue?: string }>;
}

export default async function TeacherStudentsPage({ searchParams }: TeacherStudentsPageProps) {
  const [context, t, query] = await Promise.all([
    resolveServerContext(),
    getTranslations('teacherWorkbench'),
    searchParams,
  ]);

  if (!context) return redirectToLogin('/teacher/students');
  const access = await resolveTeacherWorkspace(context.actor.userId);
  if (access.status !== 'ready') return null;

  const students = await listAssignedStudents(context.actor.userId);
  const initialStatus = query.status === 'attention' || query.queue ? 'attention' : undefined;

  return (
    <div className="min-w-0 space-y-7">
      <header>
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('students.eyebrow')}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
          {t('students.pageTitle')}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t('students.pageDescription')}
        </p>
      </header>
      <TeacherStudentList
        students={students}
        initialStatus={initialStatus}
        copy={t.raw('students.content') as TeacherStudentListProps['copy']}
      />
    </div>
  );
}
