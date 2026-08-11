import 'server-only';

import { cache } from 'react';
import { and, desc, eq } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import {
  careerGuidanceNotes,
  educationRoleAssignments,
  teacherStudentAssignments,
  users,
} from '@/lib/db/schema';
import {
  listTeacherEducationContexts,
  resolveTeacherStudentAccess,
} from '@/lib/auth/education-guard';
import type {
  TeacherAbilityEvidence,
  TeacherGuidanceRecord,
  TeacherGrowthTask,
  TeacherStudentDetail,
  TeacherStudentStatus,
  TeacherStudentSummary,
  TeacherWorkspaceView,
} from '@/components/teacher/types';
import {
  getCareerMatch,
  getCareerPath,
  getCareerProfile,
  listCareerGoals,
  listCareerTasks,
} from './service';
import { ABILITY_CATALOG, DIMENSION_NAMES } from './catalog';
import { parseJson, toIso } from './serialization';

export type TeacherWorkspaceResolution =
  | { status: 'ready'; organizationId: string; view: TeacherWorkspaceView }
  | { status: 'denied' }
  | { status: 'unconfigured' };

function studentMetadata(settings: unknown): { program: string; cohort: string } {
  const parsed = parseJson<Record<string, unknown>>(settings, {});
  return {
    program: typeof parsed.program === 'string' ? parsed.program : '未填写专业',
    cohort: typeof parsed.cohort === 'string' ? parsed.cohort : '未填写年级',
  };
}

function getStudentStatus(pending: number, completed: number): TeacherStudentStatus {
  if (pending > 0) return 'attention';
  if (completed > 0) return 'progress';
  return 'on_track';
}

type TeacherStudentSummaryWithMetrics = TeacherStudentSummary & {
  queueMetrics: {
    pendingEvidenceCount: number;
    pendingGoalCount: number;
    overdueTaskCount: number;
    matchDeclined: boolean;
    recentProgress: boolean;
  };
};

async function buildStudentSummary(studentId: string): Promise<TeacherStudentSummaryWithMetrics | null> {
  const studentRows = await db.select().from(users).where(eq(users.id, studentId)).limit(1);
  const student = studentRows[0];
  if (!student) return null;
  const [profile, goals, tasks] = await Promise.all([
    getCareerProfile(studentId),
    listCareerGoals(studentId),
    listCareerTasks(studentId),
  ]);
  const primaryGoal = goals.find((goal) => goal.isPrimary) ?? goals[0] ?? null;
  const match = primaryGoal ? await getCareerMatch(studentId, primaryGoal.occupationCode) : null;
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length;
  const pendingEvidence = profile.dimensions
    .flatMap((dimension) => dimension.abilities)
    .flatMap((ability) => ability.evidence)
    .filter((evidence) => evidence.status === 'pending').length;
  const overdueTasks = tasks.filter((task) => task.dueAt && task.status !== 'completed' && task.status !== 'cancelled' && new Date(task.dueAt) < new Date()).length;
  const pendingGoals = goals.filter((goal) => goal.teacherConfirmationStatus === 'unreviewed').length;
  const pendingItemCount = pendingEvidence + overdueTasks + pendingGoals;
  const recentThreshold = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentProgress = tasks.some((task) => task.status === 'completed' && new Date(task.updatedAt).getTime() >= recentThreshold);
  const metadata = studentMetadata(student.settings);
  const lastChange = [profile.updatedAt, ...tasks.map((task) => task.updatedAt)].sort().at(-1) ?? null;

  return {
    id: student.id,
    name: student.name ?? student.email ?? '未命名学生',
    program: metadata.program,
    cohort: metadata.cohort,
    targetJob: primaryGoal?.occupationName ?? null,
    matchScore: match?.score ?? null,
    evidenceCoverage: match?.evidenceCoverage ?? profile.evidenceCoverage,
    completedTaskCount,
    taskCount: tasks.length,
    status: getStudentStatus(pendingItemCount, completedTaskCount),
    lastChange,
    pendingItemCount,
    queueMetrics: {
      pendingEvidenceCount: pendingEvidence,
      pendingGoalCount: pendingGoals,
      overdueTaskCount: overdueTasks,
      matchDeclined: false,
      recentProgress,
    },
  };
}

async function listAssignedStudentsUncached(teacherUserId: string): Promise<TeacherStudentSummary[]> {
  await dbReady;
  const contexts = (await listTeacherEducationContexts(teacherUserId)).sort((a, b) => a.organizationId.localeCompare(b.organizationId));
  if (!contexts.length) return [];
  const rows = await db.select({
    organizationId: teacherStudentAssignments.organizationId,
    studentUserId: teacherStudentAssignments.studentUserId,
  }).from(teacherStudentAssignments)
    .where(and(eq(teacherStudentAssignments.teacherUserId, teacherUserId), eq(teacherStudentAssignments.status, 'active'))) as Array<{
      organizationId: string;
      studentUserId: string;
    }>;

  const activeOrganizationId = contexts[0].organizationId;
  const studentIds = [...new Set(rows.filter((row) => row.organizationId === activeOrganizationId).map((row) => row.studentUserId))];
  const summaries: TeacherStudentSummary[] = [];
  for (const studentId of studentIds) {
    const access = await resolveTeacherStudentAccess(teacherUserId, studentId, 'view');
    if (!access) continue;
    const summary = await buildStudentSummary(studentId);
    if (summary) summaries.push(summary);
  }
  return summaries.sort((a, b) => b.pendingItemCount - a.pendingItemCount || a.name.localeCompare(b.name, 'zh-CN'));
}

export const listAssignedStudents = cache(listAssignedStudentsUncached);

function buildWorkspaceView(students: TeacherStudentSummary[]): TeacherWorkspaceView {
  const records = students as TeacherStudentSummaryWithMetrics[];
  return {
    queue: [
      { kind: 'evidence_review', count: records.reduce((sum, student) => sum + student.queueMetrics.pendingEvidenceCount, 0) },
      { kind: 'goal_change', count: records.reduce((sum, student) => sum + student.queueMetrics.pendingGoalCount, 0) },
      { kind: 'overdue_task', count: records.reduce((sum, student) => sum + student.queueMetrics.overdueTaskCount, 0) },
      { kind: 'match_decline', count: records.filter((student) => student.queueMetrics.matchDeclined).length },
      { kind: 'recent_progress', count: records.filter((student) => student.queueMetrics.recentProgress).length },
    ],
    recentStudents: students.slice(0, 12),
  };
}

async function resolveTeacherWorkspaceUncached(userId: string): Promise<TeacherWorkspaceResolution> {
  await dbReady;
  const contexts = (await listTeacherEducationContexts(userId)).sort((a, b) => a.organizationId.localeCompare(b.organizationId));
  if (contexts[0]) {
    const students = await listAssignedStudents(userId);
    return { status: 'ready', organizationId: contexts[0].organizationId, view: buildWorkspaceView(students) };
  }

  const roles = await db.select({ role: educationRoleAssignments.role })
    .from(educationRoleAssignments)
    .where(and(eq(educationRoleAssignments.userId, userId), eq(educationRoleAssignments.status, 'active')))
    .limit(1);
  return roles[0] ? { status: 'denied' } : { status: 'unconfigured' };
}

export const resolveTeacherWorkspace = cache(resolveTeacherWorkspaceUncached);

function evidenceSourceType(sourceType: string): TeacherAbilityEvidence['sourceType'] {
  if (sourceType === 'resume' || sourceType === 'interview' || sourceType === 'project' || sourceType === 'certificate' || sourceType === 'teacher') return sourceType;
  return 'student';
}

function taskAbilityName(category: string, abilityCode: string | null): string {
  if (abilityCode && abilityCode in DIMENSION_NAMES) {
    return DIMENSION_NAMES[abilityCode as keyof typeof DIMENSION_NAMES];
  }
  const ability = abilityCode ? ABILITY_CATALOG.find((item) => item.code === abilityCode) : null;
  if (ability) return ability.name;
  const labels: Record<string, string> = {
    explore: '职业探索',
    learn: '能力学习',
    practice: '实践训练',
    portfolio: '作品成果',
    application: '求职行动',
  };
  return labels[category] ?? '职业发展';
}

export async function getAssignedStudentDetail(teacherUserId: string, studentId: string): Promise<TeacherStudentDetail | null> {
  await dbReady;
  const access = await resolveTeacherStudentAccess(teacherUserId, studentId, 'view');
  if (!access) return null;
  const studentRows = await db.select().from(users).where(eq(users.id, studentId)).limit(1);
  const student = studentRows[0];
  if (!student) return null;

  const [profile, goals, tasks, careerPath, rawGuidanceRows] = await Promise.all([
    getCareerProfile(studentId),
    listCareerGoals(studentId),
    listCareerTasks(studentId),
    getCareerPath(studentId),
    db.select({
      id: careerGuidanceNotes.id,
      content: careerGuidanceNotes.content,
      visibility: careerGuidanceNotes.visibility,
      authorName: users.name,
      createdAt: careerGuidanceNotes.createdAt,
    }).from(careerGuidanceNotes)
      .innerJoin(users, eq(users.id, careerGuidanceNotes.teacherId))
      .where(eq(careerGuidanceNotes.userId, studentId))
      .orderBy(desc(careerGuidanceNotes.createdAt)),
  ]);
  const guidanceRows = rawGuidanceRows as Array<{
    id: string;
    content: string;
    visibility: 'student' | 'teacher_private' | 'management';
    authorName: string | null;
    createdAt: Date;
  }>;
  const primaryGoal = goals.find((goal) => goal.isPrimary) ?? goals[0] ?? null;
  const match = primaryGoal ? await getCareerMatch(studentId, primaryGoal.occupationCode) : null;
  const allEvidence = profile.dimensions.flatMap((dimension) => dimension.abilities.flatMap((ability) =>
    ability.evidence.map((evidence) => ({ evidence, abilityName: ability.name })),
  ));
  const pendingCount = allEvidence.filter(({ evidence }) => evidence.status === 'pending').length
    + goals.filter((goal) => goal.teacherConfirmationStatus === 'unreviewed').length;
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const metadata = studentMetadata(student.settings);
  const now = new Date();

  const teacherEvidence: TeacherAbilityEvidence[] = allEvidence.map(({ evidence, abilityName }) => ({
    id: evidence.id,
    title: evidence.title,
    excerpt: evidence.excerpt,
    sourceType: evidenceSourceType(evidence.sourceType),
    sourceLabel: evidence.sourceType,
    abilityName,
    status: evidence.status === 'verified' ? 'confirmed' : evidence.status,
    updatedAt: evidence.createdAt,
  }));
  const teacherTasks: TeacherGrowthTask[] = tasks.map((task) => {
    const overdue = task.dueAt && task.status !== 'completed' && task.status !== 'cancelled' && new Date(task.dueAt) < now;
    return {
      id: task.id,
      title: task.title,
      abilityName: taskAbilityName(task.category, task.abilityCode),
      dueDate: task.dueAt,
      status: overdue ? 'overdue' : task.status === 'cancelled' ? 'todo' : task.status,
      completionCriteria: task.completionCriteria || '提交可复核的成果或证据。',
      assignedBy: task.assignedBy ?? 'system',
    };
  });
  const guidance: TeacherGuidanceRecord[] = guidanceRows
    .filter((row) => row.visibility !== 'management')
    .map((row) => ({
      id: row.id,
      content: row.content,
      visibility: row.visibility === 'teacher_private' ? 'private' : 'student',
      authorName: row.authorName ?? '指导教师',
      createdAt: toIso(row.createdAt),
    }));

  return {
    id: student.id,
    name: student.name ?? student.email ?? '未命名学生',
    program: metadata.program,
    cohort: metadata.cohort,
    targetJob: primaryGoal?.occupationName ?? null,
    matchScore: match?.score ?? null,
    evidenceCoverage: match?.evidenceCoverage ?? profile.evidenceCoverage,
    profileCompleteness: profile.completeness,
    nextMilestone: careerPath.stages.find((stage) => stage.status === 'current')?.title ?? null,
    status: getStudentStatus(pendingCount, completedCount),
    abilities: profile.dimensions.map((dimension) => ({
      key: dimension.code,
      name: dimension.name,
      level: dimension.score,
      evidenceCount: dimension.abilities.reduce((sum, ability) => sum + ability.evidenceCount, 0),
      change: null,
      updatedAt: dimension.abilities.map((ability) => ability.updatedAt).sort().at(-1) ?? null,
    })),
    evidence: teacherEvidence,
    goals: goals.map((goal) => ({
      id: goal.id,
      jobTitle: goal.occupationName,
      kind: goal.isPrimary ? 'primary' : 'alternative',
      targetDate: goal.targetDate,
      status: goal.status === 'archived' ? 'archived' : goal.teacherConfirmationStatus === 'unreviewed' ? 'pending_review' : 'active',
    })),
    path: careerPath.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      status: stage.status === 'locked' ? 'upcoming' : stage.status,
      milestone: stage.targetDate,
    })),
    tasks: teacherTasks,
    guidance,
  };
}
