import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Goal,
  ListTodo,
  TrendingUp,
  CalendarClock,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TeacherQueueKind, TeacherWorkspaceView } from './types';

export interface TeacherWorkQueueProps {
  workspace: TeacherWorkspaceView;
  copy: {
    sectionTitle: string;
    sectionDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    viewStudents: string;
    studentSectionTitle: string;
    studentSectionDescription: string;
    viewAllStudents: string;
    openStudent: string;
    noTarget: string;
    matchScore: string;
    evidenceCoverage: string;
    pendingItems: string;
    queues: Record<TeacherQueueKind, { title: string; description: string }>;
  };
}

const QUEUE_META = {
  evidence_review: { icon: FileCheck2, tone: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300' },
  goal_change: { icon: Goal, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300' },
  overdue_task: { icon: AlertTriangle, tone: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300' },
  match_decline: { icon: ArrowDownRight, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300' },
  recent_progress: { icon: TrendingUp, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300' },
  follow_up: { icon: CalendarClock, tone: 'text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300' },
} satisfies Record<TeacherQueueKind, { icon: typeof FileCheck2; tone: string }>;

export function TeacherWorkQueue({ workspace, copy }: TeacherWorkQueueProps) {
  const pendingCount = workspace.queue.reduce((total, item) => total + item.count, 0);

  return (
    <div className="space-y-8">
      <section aria-labelledby="queue-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="queue-heading" className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {copy.sectionTitle}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.sectionDescription}</p>
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/teacher/students?status=attention">
              {copy.viewStudents}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>

        {pendingCount === 0 ? (
          <Card className="mt-4 border-dashed shadow-none">
            <CardContent className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-950 dark:text-zinc-50">{copy.emptyTitle}</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.emptyDescription}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {workspace.queue.map((item) => {
              const meta = QUEUE_META[item.kind];
              const Icon = meta.icon;
              const label = copy.queues[item.kind];

              return (
                <Link
                  key={item.kind}
                  href={`/teacher/students?queue=${item.kind}`}
                  className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`flex size-10 items-center justify-center rounded-lg ${meta.tone}`}>
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{item.count}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{label.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{label.description}</p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="recent-students-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recent-students-heading" className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {copy.studentSectionTitle}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.studentSectionDescription}</p>
          </div>
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href="/teacher/students">
              {copy.viewAllStudents}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </div>

        {workspace.recentStudents.length === 0 ? (
          <Card className="mt-4 border-dashed shadow-none">
            <CardContent className="flex flex-col items-center px-6 py-10 text-center">
              <ListTodo aria-hidden="true" className="size-8 text-zinc-400" />
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{copy.emptyDescription}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {workspace.recentStudents.map((student) => (
              <Card key={student.id} className="gap-4 py-5 shadow-none">
                <CardHeader className="gap-2 px-5">
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{student.name}</CardTitle>
                      <CardDescription className="mt-1 truncate">
                        {student.program} · {student.cohort}
                      </CardDescription>
                    </div>
                    {student.pendingItemCount > 0 && (
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        {copy.pendingItems.replace('{count}', String(student.pendingItemCount))}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 px-5">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{student.targetJob ?? copy.noTarget}</p>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{copy.matchScore}</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                        {student.matchScore === null ? '—' : `${student.matchScore}%`}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{copy.evidenceCoverage}</dt>
                      <dd className="mt-1 font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                        {student.evidenceCoverage === null ? '—' : `${student.evidenceCoverage}%`}
                      </dd>
                    </div>
                  </dl>
                  <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                    <Link href={`/teacher/students/${student.id}`}>{copy.openStudent}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
