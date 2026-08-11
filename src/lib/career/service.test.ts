import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerGuidanceNotes,
  careerMatches,
  careerProfiles,
  careerProfileSnapshots,
  careerTasks,
  users,
} from '@/lib/db/schema';
import {
  getCareerMatch,
  getCareerPath,
  getCareerProfile,
  getOccupationByCode,
  listCareerTasks,
  listOccupations,
  updateCareerTaskStatus,
  upsertCareerGoal,
} from './service';

const ALICE_ID = 'career-alice';
const BOB_ID = 'career-bob';

beforeEach(async () => {
  await db.delete(careerMatches);
  await db.delete(careerGuidanceNotes);
  await db.delete(careerProfileSnapshots);
  await db.delete(careerEvidence);
  await db.delete(careerTasks);
  await db.delete(careerGoals);
  await db.delete(careerAbilities);
  await db.delete(careerProfiles);
  await db.delete(users);
  await db.insert(users).values([
    { id: ALICE_ID, email: 'career-alice@example.com', name: 'Alice', authType: 'oauth' },
    { id: BOB_ID, email: 'career-bob@example.com', name: 'Bob', authType: 'oauth' },
  ]);
});

describe('career knowledge catalog', () => {
  it('provides 12 reviewed occupations with relationships and citations', async () => {
    const occupations = await listOccupations();
    expect(occupations).toHaveLength(12);
    const frontend = await getOccupationByCode('J-FE-001');
    expect(frontend?.requirements.length).toBeGreaterThanOrEqual(5);
    expect(frontend?.relatedOccupations.length).toBeGreaterThan(0);
    expect(frontend?.citations[0].sourceUrl).toMatch(/^https:\/\//);
  });
});

describe('deterministic occupation matching', () => {
  it('keeps unknown abilities null and excludes them from the score denominator', async () => {
    const emptyMatch = await getCareerMatch(ALICE_ID, 'J-FE-001');
    expect(emptyMatch.score).toBeNull();
    expect(emptyMatch.knownWeight).toBe(0);
    expect(emptyMatch.dimensionBreakdown.every((item) => item.state === 'unknown' && item.gap === null)).toBe(true);

    await db.insert(careerAbilities).values({
      userId: ALICE_ID,
      code: 'web_frontend',
      name: 'Web 前端基础',
      dimension: 'professional_skills',
      score: 36,
      confidence: 80,
    });
    const partialMatch = await getCareerMatch(ALICE_ID, 'J-FE-001');
    expect(partialMatch.knownWeight).toBe(5);
    expect(partialMatch.score).toBe(50);
    expect(partialMatch.dimensionBreakdown.find((item) => item.abilityCode === 'testing')?.studentScore).toBeNull();
  });
});

describe('goal and growth-task loop', () => {
  it('persists a primary goal, creates a three-stage path, and turns completion into pending evidence once', async () => {
    const goal = await upsertCareerGoal(ALICE_ID, {
      occupationCode: 'J-FE-001',
      isPrimary: true,
      rationale: '希望从前端岗位开始职业发展',
    });
    expect(goal.occupationName).toBe('前端开发工程师');

    const tasks = await listCareerTasks(ALICE_ID);
    expect(tasks).toHaveLength(5);
    const path = await getCareerPath(ALICE_ID);
    expect(path.stages).toHaveLength(3);
    expect(path.stages[0].status).toBe('current');

    const task = tasks.find((item) => item.abilityCode === 'project_delivery')!;
    await updateCareerTaskStatus(ALICE_ID, task.id, 'completed');
    await updateCareerTaskStatus(ALICE_ID, task.id, 'completed');
    const evidence = await db.select().from(careerEvidence);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      userId: ALICE_ID,
      sourceType: 'task',
      sourceId: task.id,
      abilityCode: 'project_delivery',
      status: 'pending',
    });
  });

  it('does not allow one student to mutate another student task', async () => {
    await upsertCareerGoal(ALICE_ID, { occupationCode: 'J-FE-001' });
    const [aliceTask] = await listCareerTasks(ALICE_ID);
    expect(await updateCareerTaskStatus(BOB_ID, aliceTask.id, 'completed')).toBeNull();
    const unchanged = (await listCareerTasks(ALICE_ID)).find((task) => task.id === aliceTask.id);
    expect(unchanged?.status).toBe('todo');
  });

  it('does not let an empty earlier stage lock a later stage with active work', async () => {
    const goal = await upsertCareerGoal(ALICE_ID, { occupationCode: 'J-FE-001' });
    await db.delete(careerTasks);
    await db.insert(careerTasks).values({
      userId: ALICE_ID,
      goalId: goal.id,
      occupationCode: goal.occupationCode,
      abilityCode: 'project_delivery',
      title: '完成在途项目任务',
      category: 'practice',
      status: 'in_progress',
    });

    const path = await getCareerPath(ALICE_ID);
    expect(path.currentStageIndex).toBe(1);
    expect(path.stages[1].status).toBe('current');
    expect(path.stages[1].tasks).toHaveLength(1);
  });
});

describe('career profile no-data semantics', () => {
  it('returns all six dimensions without converting unknown to zero', async () => {
    const profile = await getCareerProfile(ALICE_ID);
    expect(profile.dimensions).toHaveLength(6);
    expect(profile.dimensions.every((dimension) => dimension.score === null && dimension.status === 'unknown')).toBe(true);
  });
});
