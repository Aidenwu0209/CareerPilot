import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import type { RequestContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { analysisRuns, resumes } from '@/lib/db/schema';
import { syncCareerMaterials } from './materials';
import { generateCareerReport } from './ai-report-service';
import { calculateAndPersistCareerMatch, getCareerPath, getCareerProfile } from './service';

export const ANALYSIS_STEPS = ['uploaded', 'parsed', 'profiled', 'matched', 'pathed', 'reported'] as const;
export type AnalysisStep = typeof ANALYSIS_STEPS[number];
type StepState = { code: AnalysisStep; status: 'pending' | 'running' | 'completed' | 'failed'; startedAt: string | null; completedAt: string | null; errorCode: string | null };

function initialSteps(): StepState[] {
  return ANALYSIS_STEPS.map((code) => ({ code, status: 'pending', startedAt: null, completedAt: null, errorCode: null }));
}

function parseSteps(value: unknown): StepState[] {
  if (Array.isArray(value) && value.length === ANALYSIS_STEPS.length) return value as StepState[];
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed as StepState[]; } catch { /* fall through */ }
  }
  return initialSteps();
}

export async function createAnalysisRun(userId: string, input: { modelId: string; locale: string }) {
  const id = crypto.randomUUID();
  await db.insert(analysisRuns).values({
    id, userId, status: 'pending', currentStep: 'uploaded', steps: initialSteps(), input,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  } as never);
  return getAnalysisRun(userId, id);
}

export async function listAnalysisRuns(userId: string) {
  return db.select().from(analysisRuns).where(eq(analysisRuns.userId, userId)).orderBy(desc(analysisRuns.createdAt)).limit(20);
}

export async function getLatestAnalysisRun(userId: string) {
  const [run] = await db.select({ id: analysisRuns.id }).from(analysisRuns)
    .where(eq(analysisRuns.userId, userId))
    .orderBy(desc(analysisRuns.createdAt))
    .limit(1);
  return run ? getAnalysisRun(userId, run.id) : null;
}

export async function getAnalysisRun(userId: string, id: string) {
  const [run] = await db.select().from(analysisRuns).where(and(eq(analysisRuns.id, id), eq(analysisRuns.userId, userId))).limit(1);
  if (!run) return null;
  if (run.status === 'running' && run.expiresAt.getTime() <= Date.now()) {
    const steps = parseSteps(run.steps).map((step) => step.status === 'running' ? { ...step, status: 'failed' as const, errorCode: 'RUN_EXPIRED' } : step);
    await db.update(analysisRuns).set({ status: 'failed', errorCode: 'RUN_EXPIRED', steps, updatedAt: new Date() }).where(eq(analysisRuns.id, run.id));
    return { ...run, status: 'failed' as const, errorCode: 'RUN_EXPIRED', steps };
  }
  return { ...run, steps: parseSteps(run.steps) };
}

async function executeStep(step: AnalysisStep, context: RequestContext, input: { modelId: string; locale: string }) {
  const userId = context.actor.userId;
  switch (step) {
    case 'uploaded': {
      const [resume] = await db.select({ id: resumes.id }).from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt)).limit(1);
      if (!resume) throw new Error('RESUME_REQUIRED');
      return { resumeId: resume.id };
    }
    case 'parsed': return syncCareerMaterials(userId);
    case 'profiled': {
      const profile = await getCareerProfile(userId);
      return { completeness: profile.completeness, evidenceCoverage: profile.evidenceCoverage };
    }
    case 'matched': {
      const match = await calculateAndPersistCareerMatch(userId);
      return { occupationCode: match.occupation.code, score: match.score };
    }
    case 'pathed': {
      const path = await getCareerPath(userId);
      if (!path.goal) throw new Error('GOAL_REQUIRED');
      return { stages: path.stages.length, currentStageIndex: path.currentStageIndex };
    }
    case 'reported': {
      if (!input.modelId) throw new Error('MODEL_REQUIRED');
      const report = await generateCareerReport({ context, modelId: input.modelId, locale: input.locale, mode: 'generate' });
      if (!report.ok) throw new Error(report.error);
      return { reportId: report.data?.id, operationId: report.operationId };
    }
  }
}

export async function advanceAnalysisRun(context: RequestContext, id: string, retry = false) {
  const run = await getAnalysisRun(context.actor.userId, id);
  if (!run) throw new Error('RUN_NOT_FOUND');
  if (run.status === 'completed' || run.status === 'cancelled') return run;
  if (run.status === 'running') throw new Error('RUN_BUSY');
  if (run.status === 'failed' && !retry) throw new Error(run.errorCode ?? 'RUN_FAILED');
  const steps = parseSteps(run.steps);
  const index = steps.findIndex((step) => step.status === 'pending' || step.status === 'failed');
  if (index < 0) return run;
  const step = steps[index];
  const startedAt = new Date();
  steps[index] = { ...step, status: 'running', startedAt: startedAt.toISOString(), completedAt: null, errorCode: null };
  const claimed = await db.update(analysisRuns).set({
    status: 'running', currentStep: step.code, steps, errorCode: null,
    retryCount: retry ? run.retryCount + 1 : run.retryCount,
    startedAt: run.startedAt ?? startedAt, expiresAt: new Date(Date.now() + 15 * 60 * 1000), updatedAt: startedAt,
  }).where(and(eq(analysisRuns.id, id), eq(analysisRuns.status, run.status))).returning({ id: analysisRuns.id });
  if (claimed.length === 0) throw new Error('RUN_BUSY');
  try {
    const input = (typeof run.input === 'string' ? JSON.parse(run.input) : run.input) as { modelId: string; locale: string };
    const stepResult = await executeStep(step.code, context, input);
    const completedAt = new Date();
    steps[index] = { ...steps[index], status: 'completed', completedAt: completedAt.toISOString() };
    const complete = index === steps.length - 1;
    const currentStep = complete ? step.code : steps[index + 1].code;
    const previousResult = typeof run.result === 'string' ? JSON.parse(run.result) : run.result;
    await db.update(analysisRuns).set({
      status: complete ? 'completed' : 'pending', currentStep, steps,
      result: { ...(previousResult as Record<string, unknown>), [step.code]: stepResult },
      completedAt: complete ? completedAt : null, updatedAt: completedAt,
    }).where(eq(analysisRuns.id, id));
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : 'STEP_FAILED';
    steps[index] = { ...steps[index], status: 'failed', completedAt: new Date().toISOString(), errorCode };
    await db.update(analysisRuns).set({ status: 'failed', steps, errorCode, updatedAt: new Date() }).where(eq(analysisRuns.id, id));
  }
  return getAnalysisRun(context.actor.userId, id);
}
