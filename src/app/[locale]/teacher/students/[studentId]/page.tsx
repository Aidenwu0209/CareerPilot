import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  TeacherStudentDetailView,
  type TeacherStudentDetailCopy,
} from '@/components/teacher/teacher-student-detail';
import { resolveServerContext } from '@/lib/auth/server-context';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { getAssignedStudentDetail, resolveTeacherWorkspace } from '@/lib/career/teacher-service';

interface TeacherStudentPageProps {
  params: Promise<{ studentId: string }>;
}

export default async function TeacherStudentPage({ params }: TeacherStudentPageProps) {
  const [context, t, routeParams] = await Promise.all([
    resolveServerContext(),
    getTranslations('teacherWorkbench'),
    params,
  ]);

  if (!context) return redirectToLogin('/teacher/students');
  const access = await resolveTeacherWorkspace(context.actor.userId);
  if (access.status !== 'ready') return null;

  const student = await getAssignedStudentDetail(context.actor.userId, routeParams.studentId);
  if (!student) notFound();

  return (
    <TeacherStudentDetailView
      student={student}
      copy={t.raw('detail') as TeacherStudentDetailCopy}
    />
  );
}
