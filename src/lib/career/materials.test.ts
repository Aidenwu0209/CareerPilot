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
  interviewReports,
  interviewSessions,
  occupationRequirements,
  occupations,
  resumes,
  resumeSections,
  users,
} from '@/lib/db/schema';
import { syncCareerMaterials } from './materials';

const USER_ID = 'material-user';

beforeEach(async () => {
  await db.delete(careerEvidence);
  await db.delete(careerAbilities);
  await db.delete(occupationRequirements);
  await db.delete(occupations);
  await db.delete(interviewReports);
  await db.delete(interviewSessions);
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(users);
  await db.insert(users).values({ id: USER_ID, email: 'material@example.com', authType: 'oauth' });
});

describe('career material structuring', () => {
  it('idempotently links resume and interview material while preserving unknown resume scores', async () => {
    await db.insert(resumes).values({ id: 'resume-material', userId: USER_ID, title: '前端求职简历' });
    await db.insert(resumeSections).values({
      id: 'section-projects',
      resumeId: 'resume-material',
      type: 'projects',
      title: '项目经历',
      content: { items: [{ name: '课程平台', description: '使用 React、TypeScript 和 Playwright 完成开发与自动化测试。' }] },
    });
    await db.insert(interviewSessions).values({
      id: 'interview-material',
      userId: USER_ID,
      jobTitle: '前端开发工程师',
      jobDescription: 'React 前端岗位',
      selectedInterviewers: [],
      status: 'completed',
    });
    await db.insert(interviewReports).values({
      id: 'report-material',
      sessionId: 'interview-material',
      overallScore: 82,
      dimensionScores: [],
      roundEvaluations: [],
      overallFeedback: '表达清晰，建议继续补充性能优化案例。',
      improvementPlan: [],
    });

    const first = await syncCareerMaterials(USER_ID);
    expect(first.processedSources).toBe(2);
    expect(first.evidenceCreated).toBeGreaterThanOrEqual(4);
    expect(first.abilitiesLinked).toBeGreaterThanOrEqual(4);

    const second = await syncCareerMaterials(USER_ID);
    expect(second.evidenceCreated).toBe(0);

    const evidence = await db.select().from(careerEvidence);
    expect(evidence.every((item: typeof evidence[number]) => item.status === 'pending')).toBe(true);
    const abilities = await db.select().from(careerAbilities);
    expect(abilities.find((item: typeof abilities[number]) => item.code === 'web_frontend')?.score).toBeNull();
    expect(abilities.find((item: typeof abilities[number]) => item.code === 'interview')?.score).toBeNull();
  });

  it('maps explicit active O*NET skill names to pending evidence without assigning a score', async () => {
    await db.insert(occupations).values({
      code: '15-1252.00', name: '软件开发人员', category: 'O*NET-SOC', summary: '', description: '', entryLevel: '',
      canonicalType: 'standard_occupation', active: true, scoringEligible: true,
    });
    await db.insert(occupationRequirements).values({
      id: 'onet-critical-thinking', occupationCode: '15-1252.00', abilityCode: 'onet_skill_2_a_2_a',
      abilityName: '批判性思维', dimension: 'general_competencies', targetScore: 70, weight: 4,
    });
    await db.insert(resumes).values({ id: 'resume-onet', userId: USER_ID, title: '软件开发简历' });
    await db.insert(resumeSections).values({
      id: 'section-onet', resumeId: 'resume-onet', type: 'projects', title: '项目经历',
      content: { description: '通过批判性思维比较三种架构方案，并记录选择依据。' },
    });

    await syncCareerMaterials(USER_ID);
    const evidence = await db.select().from(careerEvidence);
    expect(evidence).toContainEqual(expect.objectContaining({
      abilityCode: 'onet_skill_2_a_2_a', status: 'pending', assessedScore: null,
    }));
    const ability = (await db.select().from(careerAbilities).where(eq(careerAbilities.code, 'onet_skill_2_a_2_a')))[0];
    expect(ability).toMatchObject({ score: null, confidence: null });
  });
});
