import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const queryLog = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, {
    schema,
    logger: { logQuery: (query: string) => queryLog.push(query) },
  });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import { CareerCatalogCache } from '@/lib/cache/career-catalog-cache';
import { occupationAliases } from '@/lib/db/schema-career';
import { occupationRequirements, occupations } from '@/lib/db/schema';
import { SqlCareerKnowledgeProvider } from './knowledge-provider';

const provider = new SqlCareerKnowledgeProvider(new CareerCatalogCache(null, 'test:provider'));

beforeEach(async () => {
  await provider.invalidateCache();
  await db.delete(occupationAliases);
  await db.delete(occupationRequirements);
  await db.delete(occupations);
  await db.insert(occupations).values(Array.from({ length: 30 }, (_, index) => ({
    code: `OCC-${String(index).padStart(2, '0')}`,
    name: `软件岗位 ${index}`,
    category: '软件与互联网',
    summary: `岗位摘要 ${index}`,
    description: `岗位说明 ${index}`,
    entryLevel: '初级',
    jobFamily: '软件工程',
    industry: '信息技术',
    cities: ['广州'],
    educationLevels: ['本科'],
    active: true,
    scoringEligible: true,
  })));
  await db.insert(occupationRequirements).values(Array.from({ length: 30 }, (_, index) => ({
    id: `REQ-${index}`,
    occupationCode: `OCC-${String(index).padStart(2, '0')}`,
    abilityCode: 'software_fundamentals',
    abilityName: '软件工程基础',
    dimension: 'domain_knowledge' as const,
    targetScore: 70,
    weight: 1,
  })));
  await db.insert(occupationAliases).values(Array.from({ length: 30 }, (_, index) => ({
    id: `ALIAS-${index}`,
    catalogVersion: 'test-v1',
    occupationCode: `OCC-${String(index).padStart(2, '0')}`,
    alias: `开发岗 ${index}`,
    active: true,
  })));
  queryLog.length = 0;
});

describe('SqlCareerKnowledgeProvider query plan', () => {
  it('counts and paginates in SQL, scopes associations to the current page, and caches repeats', async () => {
    const first = await provider.listOccupations({ limit: 2, offset: 4 });
    expect(first.pageInfo).toEqual({ limit: 2, offset: 4, total: 30, hasMore: true });
    expect(first.items.map((item) => item.code)).toEqual(['OCC-04', 'OCC-05']);
    expect(first.items.map((item) => item.aliases)).toEqual([['开发岗 4'], ['开发岗 5']]);
    const firstQueryCount = queryLog.length;
    expect(firstQueryCount).toBeLessThanOrEqual(9);
    expect(queryLog.some((query) => /from "occupations"[\s\S]*limit \?/.test(query))).toBe(true);
    expect(queryLog.some((query) => /from "occupation_aliases"[\s\S]*where[\s\S]*in \(\?, \?\)/.test(query))).toBe(true);

    await provider.listOccupations({ limit: 2, offset: 4 });
    expect(queryLog).toHaveLength(firstQueryCount);
  });

  it('pushes multi-token alias/name search into SQL instead of loading every document or occupation', async () => {
    const result = await provider.listOccupations({ query: '软件 12', limit: 5 });
    expect(result.items.map((item) => item.code)).toEqual(['OCC-12']);
    expect(queryLog.filter((query) => /lower\(/.test(query)).length).toBeGreaterThanOrEqual(2);
    expect(queryLog.some((query) => /from "occupations"(?![\s\S]*where)/.test(query))).toBe(false);
  });
});
