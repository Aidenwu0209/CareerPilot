import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});
vi.mock('./materials', () => ({ syncCareerMaterials: vi.fn(async () => ({ materials: 1 })) }));
vi.mock('./ai-report-service', () => ({
  generateCareerReport: vi.fn(async () => ({ ok: true, data: { id: 'report-1' }, operationId: 'operation-1' })),
}));
vi.mock('./service', () => ({
  getCareerProfile: vi.fn(async () => ({ completeness: 80, evidenceCoverage: 70 })),
  calculateAndPersistCareerMatch: vi.fn(async () => ({ occupation: { code: '15-1252.00' }, score: 88 })),
  getCareerPath: vi.fn(async () => ({ goal: { id: 'goal-1' }, stages: [{ id: 'stage-1' }], currentStageIndex: 0 })),
}));

import { eq } from 'drizzle-orm';
import type { RequestContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { analysisRuns, resumes, users } from '@/lib/db/schema';
import { advanceAnalysisRun, createAnalysisRun, getLatestAnalysisRun } from './analysis-pipeline';

const context: RequestContext = {
  actor: { userId: 'user-1', platformRole: 'user', status: 'active' },
  tenant: { type: 'personal', organizationId: null, orgRole: null },
  billing: { accountOwnerType: 'user', accountOwnerId: 'user-1' },
};

beforeEach(async () => {
  await db.delete(analysisRuns);
  await db.delete(resumes);
  await db.delete(users);
  await db.insert(users).values({ id: 'user-1', email: 'user@example.com', authType: 'email' });
  await db.insert(resumes).values({ id: 'resume-1', userId: 'user-1', title: 'Career resume' });
});

describe('career analysis pipeline', () => {
  it('persists and completes all six ordered stages', async () => {
    let run = await createAnalysisRun('user-1', { modelId: 'model-1', locale: 'zh' });
    expect(run?.status).toBe('pending');

    for (let index = 0; index < 6; index += 1) {
      run = await advanceAnalysisRun(context, run!.id);
    }

    expect(run?.status).toBe('completed');
    expect(run?.steps.map((step: { code: string; status: string }) => `${step.code}:${step.status}`)).toEqual([
      'uploaded:completed',
      'parsed:completed',
      'profiled:completed',
      'matched:completed',
      'pathed:completed',
      'reported:completed',
    ]);
    expect(run?.result).toMatchObject({ uploaded: { resumeId: 'resume-1' }, reported: { reportId: 'report-1' } });
  });

  it('fails closed when a second request tries to advance a running stage', async () => {
    const run = await createAnalysisRun('user-1', { modelId: 'model-1', locale: 'en' });
    await db.update(analysisRuns).set({ status: 'running' }).where(eq(analysisRuns.id, run!.id));
    await expect(advanceAnalysisRun(context, run!.id)).rejects.toThrow('RUN_BUSY');
  });

  it('marks an expired running stage as retryable after refresh', async () => {
    const run = await createAnalysisRun('user-1', { modelId: 'model-1', locale: 'en' });
    const steps = run!.steps.map((step: Record<string, unknown>, index: number) => index === 0 ? { ...step, status: 'running' as const } : step);
    await db.update(analysisRuns).set({
      status: 'running',
      steps,
      expiresAt: new Date(Date.now() - 1_000),
    }).where(eq(analysisRuns.id, run!.id));

    const refreshed = await getLatestAnalysisRun('user-1');
    expect(refreshed).toMatchObject({ status: 'failed', errorCode: 'RUN_EXPIRED' });
    expect(refreshed?.steps[0]).toMatchObject({ status: 'failed', errorCode: 'RUN_EXPIRED' });
  });
});
