'use client';

import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  FileQuestion,
  Flag,
  Route,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EvidenceReviewForm } from './evidence-review-form';
import { GuidanceFollowUpForm, TeacherActionForms, type ActionFormCopy } from './teacher-action-forms';
import type {
  EvidenceSourceType,
  EvidenceStatus,
  TeacherCareerGoal,
  TeacherGrowthTask,
  TeacherPathStage,
  TeacherStudentDetail,
  TeacherStudentStatus,
} from './types';

interface TeacherStudentDetailCopy {
  back: string;
  breadcrumbs: {
    label: string;
    workspace: string;
    students: string;
  };
  noTarget: string;
  status: Record<TeacherStudentStatus, string>;
  metrics: {
    matchScore: string;
    evidenceCoverage: string;
    profileCompleteness: string;
    nextMilestone: string;
    insufficient: string;
  };
  tabs: {
    overview: string;
    profile: string;
    goals: string;
    tasks: string;
    guidance: string;
  };
  overview: {
    title: string;
    description: string;
    attentionTitle: string;
    attentionDescription: string;
    progressTitle: string;
    progressDescription: string;
    nextActionTitle: string;
    nextActionDescription: string;
    noMilestone: string;
  };
  profile: {
    abilityTitle: string;
    abilityDescription: string;
    level: string;
    evidenceCount: string;
    change: string;
    noLevel: string;
    evidenceTitle: string;
    evidenceDescription: string;
    noEvidenceTitle: string;
    noEvidenceDescription: string;
    noEvidenceAction: string;
    ability: string;
    source: string;
    sourceTypes: Record<EvidenceSourceType, string>;
    evidenceStatus: Record<EvidenceStatus, string>;
    review: {
      trigger: string;
      title: string;
      description: string;
      reasonLabel: string;
      reasonPlaceholder: string;
      decisionLabel: string;
      confirmDecision: string;
      rejectDecision: string;
      scoreLabel: string;
      scoreHelp: string;
      scorePlaceholder: string;
      assessedScore: string;
      reviewReason: string;
      confirm: string;
      reject: string;
      submitting: string;
      success: string;
      error: string;
    };
  };
  goals: {
    goalTitle: string;
    goalDescription: string;
    primary: string;
    alternative: string;
    targetDate: string;
    noDate: string;
    goalStatus: Record<TeacherCareerGoal['status'], string>;
    pathTitle: string;
    pathDescription: string;
    milestone: string;
    pathStatus: Record<TeacherPathStage['status'], string>;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
  };
  tasks: {
    title: string;
    description: string;
    ability: string;
    dueDate: string;
    noDueDate: string;
    criteria: string;
    assignedBy: string;
    status: Record<TeacherGrowthTask['status'], string>;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
  };
  guidance: {
    title: string;
    description: string;
    studentVisible: string;
    privateNote: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
  };
  actions: ActionFormCopy;
}

function MetricCard({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <Card className="gap-3 py-5 shadow-none">
      <CardHeader className="px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value === null ? '—' : `${value}${suffix ?? ''}`}</CardTitle>
      </CardHeader>
      {value !== null && suffix === '%' && (
        <CardContent className="px-5">
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          >
            <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function EmptySection({ title, description, action }: { title: string; description: string; action?: string }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-col items-center px-6 py-10 text-center">
        <FileQuestion aria-hidden="true" className="size-8 text-zinc-400" />
        <h3 className="mt-4 font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
        <p className="mt-1 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">{description}</p>
        {action ? (
          <Button asChild size="sm" className="mt-4">
            <a href="#teacher-student-actions">{action}</a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OverviewTab({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  const activeTasks = student.tasks.filter((task) => task.status === 'todo' || task.status === 'in_progress' || task.status === 'overdue');
  const pendingEvidence = student.evidence.filter((item) => item.status === 'pending');

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={copy.metrics.matchScore} value={student.matchScore} suffix="%" />
        <MetricCard label={copy.metrics.evidenceCoverage} value={student.evidenceCoverage} suffix="%" />
        <MetricCard label={copy.metrics.profileCompleteness} value={student.profileCompleteness} suffix="%" />
        <Card className="gap-3 py-5 shadow-none">
          <CardHeader className="px-5">
            <CardDescription>{copy.metrics.nextMilestone}</CardDescription>
            <CardTitle className="text-base leading-6">{student.nextMilestone ?? copy.overview.noMilestone}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4 py-5 shadow-none">
          <CardHeader className="px-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <CalendarClock aria-hidden="true" className="size-4" />
            </span>
            <CardTitle className="text-base">{copy.overview.attentionTitle}</CardTitle>
            <CardDescription className="leading-5">{copy.overview.attentionDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 text-2xl font-semibold tabular-nums">{pendingEvidence.length}</CardContent>
        </Card>
        <Card className="gap-4 py-5 shadow-none">
          <CardHeader className="px-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <Sparkles aria-hidden="true" className="size-4" />
            </span>
            <CardTitle className="text-base">{copy.overview.progressTitle}</CardTitle>
            <CardDescription className="leading-5">{copy.overview.progressDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 text-2xl font-semibold tabular-nums">
            {student.abilities.filter((ability) => ability.change !== null && ability.change > 0).length}
          </CardContent>
        </Card>
        <Card className="gap-4 py-5 shadow-none">
          <CardHeader className="px-5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <Flag aria-hidden="true" className="size-4" />
            </span>
            <CardTitle className="text-base">{copy.overview.nextActionTitle}</CardTitle>
            <CardDescription className="leading-5">{copy.overview.nextActionDescription}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 text-2xl font-semibold tabular-nums">{activeTasks.length}</CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileTab({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="abilities-heading">
        <h2 id="abilities-heading" className="text-lg font-semibold">{copy.profile.abilityTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.profile.abilityDescription}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {student.abilities.map((ability) => (
            <Card key={ability.key} className="gap-4 py-5 shadow-none">
              <CardHeader className="px-5">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base leading-6">{ability.name}</CardTitle>
                  {ability.change !== null && ability.change !== 0 && (
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      {ability.change > 0 ? '+' : ''}{ability.change}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-5">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{copy.profile.level}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{ability.level === null ? copy.profile.noLevel : `${ability.level} / 100`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{copy.profile.evidenceCount}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{ability.evidenceCount}</dd>
                  </div>
                </dl>
                {ability.level !== null && (
                  <div
                    role="progressbar"
                    aria-label={ability.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={ability.level}
                    className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                  >
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, ability.level))}%` }} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-lg font-semibold">{copy.profile.evidenceTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.profile.evidenceDescription}</p>
        {student.evidence.length === 0 ? (
          <div className="mt-4"><EmptySection title={copy.profile.noEvidenceTitle} description={copy.profile.noEvidenceDescription} action={copy.profile.noEvidenceAction} /></div>
        ) : (
          <div className="mt-4 space-y-3">
            {student.evidence.map((evidence) => (
              <Card key={evidence.id} className="gap-4 py-5 shadow-none">
                <CardHeader className="px-5">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-6">{evidence.title}</CardTitle>
                      <CardDescription className="mt-1 leading-5">{evidence.excerpt}</CardDescription>
                    </div>
                    <Badge variant={evidence.status === 'pending' ? 'outline' : 'secondary'} className="w-fit shrink-0">
                      {copy.profile.evidenceStatus[evidence.status]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 px-5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0 space-y-3">
                    <dl className="grid min-w-0 gap-x-6 gap-y-2 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
                      <div><dt className="inline">{copy.profile.ability}：</dt><dd className="inline text-zinc-900 dark:text-zinc-100">{evidence.abilityName}</dd></div>
                      <div><dt className="inline">{copy.profile.source}：</dt><dd className="inline text-zinc-900 dark:text-zinc-100">{copy.profile.sourceTypes[evidence.sourceType]} · {evidence.sourceLabel}</dd></div>
                    </dl>
                    {evidence.status === 'confirmed' && typeof evidence.assessedScore === 'number' ? (
                      <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                        <p className="font-medium">{copy.profile.review.assessedScore.replace('{score}', String(evidence.assessedScore))}</p>
                        {evidence.reviewReason ? <p className="mt-1">{copy.profile.review.reviewReason.replace('{reason}', evidence.reviewReason)}</p> : null}
                      </div>
                    ) : null}
                  </div>
                  {evidence.status === 'pending' && (
                    <EvidenceReviewForm studentId={student.id} evidenceId={evidence.id} copy={copy.profile.review} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GoalsTab({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <section aria-labelledby="goals-heading">
        <h2 id="goals-heading" className="text-lg font-semibold">{copy.goals.goalTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.goals.goalDescription}</p>
        <div className="mt-4 space-y-3">
          {student.goals.length === 0 ? (
            <EmptySection title={copy.goals.emptyTitle} description={copy.goals.emptyDescription} action={copy.goals.emptyAction} />
          ) : student.goals.map((goal) => (
            <Card key={goal.id} className="gap-4 py-5 shadow-none">
              <CardHeader className="px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge variant={goal.kind === 'primary' ? 'default' : 'secondary'}>
                      {goal.kind === 'primary' ? copy.goals.primary : copy.goals.alternative}
                    </Badge>
                    <CardTitle className="mt-3 text-base leading-6">{goal.jobTitle}</CardTitle>
                  </div>
                  <Badge variant="outline">{copy.goals.goalStatus[goal.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="px-5 text-sm text-zinc-600 dark:text-zinc-400">
                {copy.goals.targetDate}：<span className="text-zinc-900 dark:text-zinc-100">{goal.targetDate ?? copy.goals.noDate}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="path-heading">
        <h2 id="path-heading" className="text-lg font-semibold">{copy.goals.pathTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.goals.pathDescription}</p>
        <ol className="mt-4 space-y-0">
          {student.path.length === 0 ? (
            <EmptySection title={copy.goals.emptyTitle} description={copy.goals.emptyDescription} action={copy.goals.emptyAction} />
          ) : student.path.map((stage, index) => (
            <li key={stage.id} className="relative flex gap-4 pb-5 last:pb-0">
              {index < student.path.length - 1 && <span aria-hidden="true" className="absolute left-[0.6875rem] top-6 h-[calc(100%-1.25rem)] w-px bg-zinc-200 dark:bg-zinc-700" />}
              <span className="relative mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700">
                {stage.status === 'completed' ? <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" /> : stage.status === 'current' ? <Route aria-hidden="true" className="size-4 text-blue-600" /> : <Circle aria-hidden="true" className="size-3 text-zinc-400" />}
              </span>
              <Card className="min-w-0 flex-1 gap-3 py-4 shadow-none">
                <CardHeader className="px-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-5">{stage.title}</CardTitle>
                    <Badge variant="secondary">{copy.goals.pathStatus[stage.status]}</Badge>
                  </div>
                  <CardDescription className="leading-5">{stage.description}</CardDescription>
                </CardHeader>
                {stage.milestone && <CardContent className="px-4 text-xs text-zinc-600 dark:text-zinc-400">{copy.goals.milestone}：{stage.milestone}</CardContent>}
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function TasksTab({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  return (
    <section aria-labelledby="tasks-heading">
      <h2 id="tasks-heading" className="text-lg font-semibold">{copy.tasks.title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.tasks.description}</p>
      {student.tasks.length === 0 ? (
        <div className="mt-4"><EmptySection title={copy.tasks.emptyTitle} description={copy.tasks.emptyDescription} action={copy.tasks.emptyAction} /></div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {student.tasks.map((task) => (
            <Card key={task.id} className="gap-4 py-5 shadow-none">
              <CardHeader className="px-5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <CardTitle className="text-base leading-6">{task.title}</CardTitle>
                  <Badge variant={task.status === 'overdue' ? 'destructive' : 'secondary'} className="shrink-0">{copy.tasks.status[task.status]}</Badge>
                </div>
                <CardDescription>{copy.tasks.ability}：{task.abilityName}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 text-sm">
                <p><span className="text-zinc-500 dark:text-zinc-400">{copy.tasks.dueDate}：</span>{task.dueDate ?? copy.tasks.noDueDate}</p>
                <p className="leading-6"><span className="text-zinc-500 dark:text-zinc-400">{copy.tasks.criteria}：</span>{task.completionCriteria}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{copy.tasks.assignedBy}：{task.assignedBy}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function GuidanceTab({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  return (
    <section aria-labelledby="guidance-heading">
      <h2 id="guidance-heading" className="text-lg font-semibold">{copy.guidance.title}</h2>
      <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{copy.guidance.description}</p>
      {student.guidance.length === 0 ? (
        <div className="mt-4"><EmptySection title={copy.guidance.emptyTitle} description={copy.guidance.emptyDescription} action={copy.guidance.emptyAction} /></div>
      ) : (
        <ol className="mt-4 space-y-3">
          {student.guidance.map((record) => (
            <li key={record.id}>
              <Card className="gap-4 py-5 shadow-none">
                <CardHeader className="px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {record.visibility === 'student' ? <Eye aria-hidden="true" className="size-4 text-blue-600" /> : <EyeOff aria-hidden="true" className="size-4 text-zinc-500" />}
                      {record.visibility === 'student' ? copy.guidance.studentVisible : copy.guidance.privateNote}
                    </div>
                    <time className="text-xs text-zinc-500 dark:text-zinc-400">{record.createdAt}</time>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{record.content}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{record.authorName}</p>
                  <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">{copy.actions.guidance.priority[record.priority]}</Badge><Badge variant="secondary">{copy.actions.guidance.followUpStatus[record.followUpStatus]}</Badge>{record.nextFollowUpAt ? <span className="text-muted-foreground">{copy.actions.guidance.nextFollowUpLabel}: {record.nextFollowUpAt.slice(0, 10)}</span> : null}</div>
                  <GuidanceFollowUpForm studentId={student.id} record={record} copy={copy.actions.guidance} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function TeacherStudentDetailView({ student, copy }: { student: TeacherStudentDetail; copy: TeacherStudentDetailCopy }) {
  return (
    <div className="min-w-0 space-y-6">
      <Breadcrumbs
        label={copy.breadcrumbs.label}
        items={[
          { label: copy.breadcrumbs.workspace, href: '/teacher' },
          { label: copy.breadcrumbs.students, href: '/teacher/students' },
          { label: student.name },
        ]}
      />

      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">{student.name}</h1>
            <Badge variant={student.status === 'attention' ? 'destructive' : 'secondary'}>{copy.status[student.status]}</Badge>
          </div>
          <p className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-400">{student.program} · {student.cohort}</p>
          <p className="mt-1 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">{student.targetJob ?? copy.noTarget}</p>
        </div>
        <div id="teacher-student-actions" className="scroll-mt-24">
          <TeacherActionForms
            studentId={student.id}
            abilities={student.abilities.map(({ key, name }) => ({ key, name }))}
            copy={copy.actions}
          />
        </div>
      </div>

      <Tabs defaultValue="overview" className="min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-5">
          <TabsTrigger className="min-h-10 whitespace-normal text-center leading-5" value="overview">{copy.tabs.overview}</TabsTrigger>
          <TabsTrigger className="min-h-10 whitespace-normal text-center leading-5" value="profile">{copy.tabs.profile}</TabsTrigger>
          <TabsTrigger className="min-h-10 whitespace-normal text-center leading-5" value="goals">{copy.tabs.goals}</TabsTrigger>
          <TabsTrigger className="min-h-10 whitespace-normal text-center leading-5" value="tasks">{copy.tabs.tasks}</TabsTrigger>
          <TabsTrigger className="min-h-10 whitespace-normal text-center leading-5" value="guidance">{copy.tabs.guidance}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5"><OverviewTab student={student} copy={copy} /></TabsContent>
        <TabsContent value="profile" className="mt-5"><ProfileTab student={student} copy={copy} /></TabsContent>
        <TabsContent value="goals" className="mt-5"><GoalsTab student={student} copy={copy} /></TabsContent>
        <TabsContent value="tasks" className="mt-5"><TasksTab student={student} copy={copy} /></TabsContent>
        <TabsContent value="guidance" className="mt-5"><GuidanceTab student={student} copy={copy} /></TabsContent>
      </Tabs>
    </div>
  );
}

export type { TeacherStudentDetailCopy };
