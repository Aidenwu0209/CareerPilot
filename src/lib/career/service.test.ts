import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
  careerKnowledgeDocuments,
  occupationRelations,
  occupationRequirements,
  occupations,
  users,
} from '@/lib/db/schema';
import {
  calculateAndPersistCareerMatch,
  CareerGoalRequiredError,
  CareerValidationError,
  getCareerMatch,
  getCareerPath,
  getCareerProfile,
  getOccupationByCode,
  listCareerTasks,
  listOccupations,
  submitCareerEvidence,
  updateCareerTaskStatus,
  upsertCareerGoal,
} from './service';
import { careerKnowledgeProvider } from './knowledge-provider';
import { reviewAndAggregateCareerEvidence } from './evidence-assessment';

const ALICE_ID = 'career-alice';
const BOB_ID = 'career-bob';

beforeEach(async () => {
  await careerKnowledgeProvider.invalidateCache();
  await db.delete(careerMatches);
  await db.delete(careerGuidanceNotes);
  await db.delete(careerProfileSnapshots);
  await db.delete(careerEvidence);
  await db.delete(careerTasks);
  await db.delete(careerGoals);
  await db.delete(careerAbilities);
  await db.delete(careerProfiles);
  await db.delete(careerKnowledgeDocuments);
  await db.delete(occupationRelations);
  await db.delete(occupationRequirements);
  await db.delete(occupations);
  await db.delete(users);
  await db.insert(users).values([
    { id: ALICE_ID, email: 'career-alice@example.com', name: 'Alice', authType: 'oauth' },
    { id: BOB_ID, email: 'career-bob@example.com', name: 'Bob', authType: 'oauth' },
  ]);
  await db.insert(occupations).values([
    {
      code: 'J-FE-001', name: '前端开发工程师', category: '软件与互联网',
      summary: '前端岗位', description: '构建可访问的Web应用', entryLevel: '初级',
      catalogVersion: 'test-catalog-v1', active: true, scoringEligible: true,
    },
    {
      code: 'J-FS-001', name: '全栈开发工程师', category: '软件与互联网',
      summary: '全栈岗位', description: '交付端到端应用', entryLevel: '初级',
      catalogVersion: 'test-catalog-v1', active: true, scoringEligible: true,
    },
  ]);
  await db.insert(occupationRequirements).values([
    { id: 'req-web', occupationCode: 'J-FE-001', abilityCode: 'web_frontend', abilityName: 'Web 前端基础', dimension: 'professional_skills', targetScore: 72, weight: 5, required: true, description: '前端基础' },
    { id: 'req-test', occupationCode: 'J-FE-001', abilityCode: 'testing', abilityName: '软件测试与质量', dimension: 'professional_skills', targetScore: 55, weight: 2, required: true, description: '测试基础' },
    { id: 'req-project', occupationCode: 'J-FE-001', abilityCode: 'project_delivery', abilityName: '项目交付', dimension: 'project_practice', targetScore: 65, weight: 3, required: true, description: '项目经验' },
  ]);
  await db.insert(occupationRelations).values({ id: 'rel-fe-fs', fromCode: 'J-FE-001', toCode: 'J-FS-001', relationType: 'progresses_to', description: '全栈发展' });
  await db.insert(careerKnowledgeDocuments).values({ id: 'doc-fe', occupationCode: 'J-FE-001', title: '前端职业标准', content: '前端职业标准说明', sourceLabel: '测试权威来源', sourceUrl: 'https://example.com/frontend' });
});

describe('career knowledge catalog', () => {
  it('reads the explicitly published SQL catalog with relationships and citations', async () => {
    const occupations = await listOccupations();
    expect(occupations).toHaveLength(2);
    expect(occupations.find((item) => item.code === 'J-FE-001')?.scoringEligible).toBe(true);
    expect(occupations.find((item) => item.code === 'J-FS-001')?.scoringEligible).toBe(false);
    const frontend = await getOccupationByCode('J-FE-001');
    expect(frontend?.requirements.length).toBe(3);
    expect(frontend?.relatedOccupations.length).toBeGreaterThan(0);
    expect(frontend?.citations[0].sourceUrl).toMatch(/^https:\/\//);
    expect((await getOccupationByCode('J-FS-001'))?.scoringEligible).toBe(false);
  });
});

describe('deterministic occupation matching', () => {
  it('requires an explicit occupation or primary goal instead of selecting the first catalog item', async () => {
    await expect(getCareerMatch(ALICE_ID)).rejects.toBeInstanceOf(CareerGoalRequiredError);
  });

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
    expect(partialMatch.score).toBeNull();
    expect(partialMatch.scoringStatus).toBe('insufficient_evidence');
    expect(partialMatch.knownCoverage).toBe(50);
    expect(partialMatch.dimensionBreakdown.find((item) => item.abilityCode === 'testing')?.studentScore).toBeNull();
  });

  it('shows a score only after both known and verified-evidence thresholds pass, then persists an explicit snapshot', async () => {
    await db.insert(careerAbilities).values([
      { userId: ALICE_ID, code: 'web_frontend', name: 'Web 前端基础', dimension: 'professional_skills', score: 72, confidence: 90 },
      { userId: ALICE_ID, code: 'testing', name: '软件测试与质量', dimension: 'professional_skills', score: 55, confidence: 90 },
      { userId: ALICE_ID, code: 'project_delivery', name: '项目交付', dimension: 'project_practice', score: 65, confidence: 90 },
    ]);
    await db.insert(careerEvidence).values([
      { userId: ALICE_ID, abilityCode: 'web_frontend', sourceType: 'project', sourceId: 'verified-web', title: '前端项目', status: 'verified', assessedScore: 72 },
      { userId: ALICE_ID, abilityCode: 'project_delivery', sourceType: 'project', sourceId: 'verified-project', title: '交付项目', status: 'verified', assessedScore: 65 },
    ]);

    const match = await calculateAndPersistCareerMatch(ALICE_ID, 'J-FE-001');
    expect(match).toMatchObject({ scoringStatus: 'ready', score: 100, knownCoverage: 100, evidenceCoverage: 80 });
    expect(match.confidence).toBe(88);
    expect((await db.select().from(careerMatches))).toHaveLength(1);
  });

  it('marks candidate catalog occupations as not eligible instead of asking for more evidence', async () => {
    await db.update(occupations).set({ scoringEligible: false, canonicalType: 'unresolved_placeholder' })
      .where(eq(occupations.code, 'J-FE-001'));
    const match = await getCareerMatch(ALICE_ID, 'J-FE-001');
    expect(match).toMatchObject({ scoringStatus: 'not_eligible', score: null, confidence: null });
  });

  it('does not count verified evidence without an assessed score toward coverage or readiness', async () => {
    await db.insert(careerAbilities).values([
      { userId: ALICE_ID, code: 'web_frontend', name: 'Web 前端基础', dimension: 'professional_skills', score: 72, confidence: 90 },
      { userId: ALICE_ID, code: 'testing', name: '软件测试与质量', dimension: 'professional_skills', score: 55, confidence: 90 },
      { userId: ALICE_ID, code: 'project_delivery', name: '项目交付', dimension: 'project_practice', score: 65, confidence: 90 },
    ]);
    await db.insert(careerEvidence).values([
      { userId: ALICE_ID, abilityCode: 'web_frontend', sourceType: 'project', sourceId: 'unscored-web', title: '未量化前端项目', status: 'verified' },
      { userId: ALICE_ID, abilityCode: 'project_delivery', sourceType: 'project', sourceId: 'unscored-project', title: '未量化交付项目', status: 'verified' },
    ]);
    const match = await getCareerMatch(ALICE_ID, 'J-FE-001');
    expect(match).toMatchObject({ scoringStatus: 'insufficient_evidence', score: null, evidenceCoverage: 0 });
    expect(match.strengths).toEqual([]);
  });
});

describe('career evidence assessment transaction', () => {
  it('atomically reviews evidence, aggregates the ability, writes the audit note and snapshots SQLite state', async () => {
    await db.insert(careerEvidence).values({
      id: 'pending-evidence',
      userId: ALICE_ID,
      abilityCode: 'web_frontend',
      sourceType: 'manual',
      sourceId: 'manual-evidence',
      title: '前端课程项目',
      status: 'pending',
    });
    const result = await reviewAndAggregateCareerEvidence({
      studentId: ALICE_ID,
      actorUserId: BOB_ID,
      evidenceId: 'pending-evidence',
      evidenceTitle: '前端课程项目',
      abilityCode: 'web_frontend',
      decision: 'confirmed',
      reason: '代码与演示均可复核',
      score: 80,
    });
    expect(result).toMatchObject({ score: 80, evidenceCount: 1, confidence: 60 });
    expect(await db.select().from(careerGuidanceNotes)).toHaveLength(1);
    expect(await db.select().from(careerProfileSnapshots)).toHaveLength(1);
    expect((await db.select().from(careerEvidence))[0].status).toBe('verified');
  });
});

describe('goal and growth-task loop', () => {
  it('rejects inactive legacy or requirement-free occupations as new goals', async () => {
    await db.update(occupations).set({ active: false }).where(eq(occupations.code, 'J-FE-001'));
    await expect(upsertCareerGoal(ALICE_ID, { occupationCode: 'J-FE-001' })).rejects.toBeInstanceOf(CareerValidationError);
    await expect(upsertCareerGoal(ALICE_ID, { occupationCode: 'J-FS-001' })).rejects.toBeInstanceOf(CareerValidationError);
  });

  it('allows only active-goal requirements to be submitted as unscored pending evidence', async () => {
    await expect(submitCareerEvidence(ALICE_ID, {
      occupationCode: 'J-FE-001',
      abilityCode: 'web_frontend',
      title: '课程平台前端实现',
      description: '实现响应式页面并补充测试。',
      sourceUrl: 'https://example.com/project',
    })).rejects.toBeInstanceOf(CareerValidationError);

    await upsertCareerGoal(ALICE_ID, { occupationCode: 'J-FE-001' });
    const submitted = await submitCareerEvidence(ALICE_ID, {
      occupationCode: 'J-FE-001',
      abilityCode: 'web_frontend',
      title: '课程平台前端实现',
      description: '实现响应式页面并补充测试。',
      sourceUrl: 'https://example.com/project',
    });
    expect(submitted).toMatchObject({
      occupationCode: 'J-FE-001',
      abilityCode: 'web_frontend',
      status: 'pending',
      assessedScore: null,
    });
    expect((await db.select().from(careerAbilities).where(eq(careerAbilities.code, 'web_frontend')))[0].score).toBeNull();
    await expect(submitCareerEvidence(ALICE_ID, {
      occupationCode: 'J-FE-001',
      abilityCode: 'not-a-requirement',
      title: '无关材料',
      description: '不应被接收。',
    })).rejects.toBeInstanceOf(CareerValidationError);
  });

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
