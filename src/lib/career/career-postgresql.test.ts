import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });
vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const { resolve } = await import('node:path');
  const pg = new PGlite();
  await pg.waitReady;
  const db = drizzle(pg);
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import { CareerCatalogCache } from '@/lib/cache/career-catalog-cache';
import {
  careerAbilities,
  careerEvidence,
  careerGuidanceNotes,
  careerKnowledgeDocuments,
  careerProfileSnapshots,
  occupationRequirements,
  occupations,
  users,
} from '@/lib/db/schema';
import { reviewAndAggregateCareerEvidence } from './evidence-assessment';
import { SqlCareerKnowledgeProvider } from './knowledge-provider';

const provider = new SqlCareerKnowledgeProvider(new CareerCatalogCache(null, 'test:postgres'));

beforeEach(async () => {
  await provider.invalidateCache();
  await db.delete(careerGuidanceNotes);
  await db.delete(careerProfileSnapshots);
  await db.delete(careerEvidence);
  await db.delete(careerAbilities);
  await db.delete(careerKnowledgeDocuments);
  await db.delete(occupationRequirements);
  await db.delete(occupations);
  await db.delete(users);
  await db.insert(users).values([
    { id: 'student-pg', email: 'student-pg@example.com', authType: 'oauth' },
    { id: 'teacher-pg', email: 'teacher-pg@example.com', authType: 'oauth' },
  ]);
  await db.insert(occupations).values({
    code: 'OCC-PG',
    name: 'PostgreSQL 开发工程师',
    category: '软件与互联网',
    summary: '数据库岗位',
    description: '负责关系数据库开发',
    entryLevel: '初级',
    jobFamily: '软件工程',
    industry: '信息技术',
    cities: ['广州'],
    educationLevels: ['本科'],
    active: true,
    scoringEligible: true,
  });
  await db.insert(occupationRequirements).values({
    id: 'REQ-PG',
    occupationCode: 'OCC-PG',
    abilityCode: 'database',
    abilityName: '数据库能力',
    dimension: 'professional_skills',
    targetScore: 70,
    weight: 1,
  });
  await db.insert(careerKnowledgeDocuments).values({
    id: 'DOC-PG',
    occupationCode: 'OCC-PG',
    title: '数据库职业标准',
    content: '关系数据库 PostgreSQL 工程实践',
    sourceLabel: '测试来源',
    sourceUrl: 'https://example.com/postgresql',
  });
});

describe('career data layer on real PostgreSQL semantics', () => {
  it('runs filtered pagination, detail hydration and DB-side knowledge search in PGlite', async () => {
    const page = await provider.listOccupations({ query: 'PostgreSQL', city: '广州', limit: 5 });
    expect(page.pageInfo.total).toBe(1);
    expect(page.items[0]).toMatchObject({ code: 'OCC-PG', scoringEligible: true });
    expect((await provider.getOccupationByCode('OCC-PG'))?.requirements).toHaveLength(1);
    expect(await provider.search('关系数据库 PostgreSQL')).toHaveLength(1);
  });

  it('executes the shared asynchronous evidence-review transaction atomically', async () => {
    await db.insert(careerEvidence).values({
      id: 'EVIDENCE-PG',
      userId: 'student-pg',
      abilityCode: 'database',
      sourceType: 'manual',
      sourceId: 'manual-pg',
      title: '数据库课程项目',
      status: 'pending',
    });
    const result = await reviewAndAggregateCareerEvidence({
      studentId: 'student-pg',
      actorUserId: 'teacher-pg',
      evidenceId: 'EVIDENCE-PG',
      evidenceTitle: '数据库课程项目',
      abilityCode: 'database',
      decision: 'confirmed',
      reason: '可运行且可复核',
      score: 82,
    });
    expect(result).toMatchObject({ score: 82, evidenceCount: 1, confidence: 60 });
    expect(await db.select().from(careerGuidanceNotes)).toHaveLength(1);
    expect(await db.select().from(careerProfileSnapshots)).toHaveLength(1);
  });
});
