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
  careerCatalogEntries,
  careerCatalogVersions,
  careerColleges,
  careerMajors,
  careerSourceSnapshots,
  majorOccupationEdges,
  occupationAliases,
} from '@/lib/db/schema-career';
import { careerKnowledgeDocuments, occupationRequirements, occupations } from '@/lib/db/schema';
import { applyCareerCatalog, dryRunCareerCatalog, rollbackCareerCatalog, stageCareerCatalog, type CareerCatalogBundle } from './catalog-import';
import { careerKnowledgeProvider } from './knowledge-provider';

function envelope<T>(version: string, items: T[]) {
  return { schema_version: '1.0.0', catalog_version: version, generated_at: '2026-08-12T00:00:00.000Z', items };
}

function bundle(version: string, code: string, name: string): CareerCatalogBundle {
  return {
    colleges: envelope(version, [{ id: 'gcc-it', name: '信息技术学院', source_ids: ['src-1'], review_status: 'approved' }]),
    majors: envelope(version, [{ id: 'major-se', college_id: 'gcc-it', name: '软件工程', degree_level: '本科', source_ids: ['src-1'], review_status: 'approved' }]),
    occupations: envelope(version, [{
      code, name, canonical_type: 'national_occupation' as const, category: '软件与互联网', job_family: '软件工程',
      industry: '信息技术', cities: ['广州'], education_levels: ['本科'], summary: `${name}摘要`, description: `${name}描述`,
      entry_level: '初级', source_ids: ['src-1'], review_status: 'approved', scoring_eligible: true,
    }]),
    occupation_aliases: envelope(version, [{ id: `alias-${code}`, occupation_code: code, alias: `${name}（校招）`, source_ids: ['src-1'], review_status: 'approved' }]),
    major_occupation_edges: envelope(version, [{ id: `edge-${code}`, major_id: 'major-se', occupation_code: code, relation_type: 'primary' as const, source_ids: ['src-1'], review_required: false }]),
    occupation_requirements: envelope(version, [{
      id: `req-${code}`, occupation_code: code, ability_code: 'software_fundamentals', ability_name: '软件工程基础',
      dimension: 'domain_knowledge' as const, target_score: 70, weight: 5, required: true, description: '掌握软件工程基础',
      education_level: '本科', experience_level: '应届', region: '广州', source_ids: ['src-1'], review_status: 'approved',
    }]),
    sources: envelope(version, [{
      id: 'src-1', url: 'https://example.edu/occupation', title: '职业说明', publisher: '测试来源', source_type: 'official',
      fetched_at: '2026-08-12T00:00:00.000Z', content_sha256: 'a'.repeat(64), http_status: 200, robots_status: 'allowed',
    }]),
    legacy_occupation_map: envelope(version, []),
    manifest: { publication_status: 'approved', scoring_safe: true },
  };
}

beforeEach(async () => {
  await db.delete(majorOccupationEdges);
  await db.delete(occupationAliases);
  await db.delete(careerMajors);
  await db.delete(careerColleges);
  await db.delete(careerSourceSnapshots);
  await db.delete(careerKnowledgeDocuments);
  await db.delete(occupationRequirements);
  await db.delete(occupations);
  await db.delete(careerCatalogEntries);
  await db.delete(careerCatalogVersions);
});

describe('versioned career catalog import', () => {
  it('stages, atomically applies, searches aliases, paginates and performs no GET writes', async () => {
    const input = bundle('gcc-2026-v1', 'OCC-001', '软件开发工程师');
    const diff = await dryRunCareerCatalog(input);
    expect(diff.blockingErrors).toEqual([]);
    expect(diff.occupations.added).toEqual(['OCC-001']);

    await stageCareerCatalog(input);
    expect(await db.select().from(occupations)).toHaveLength(0);
    await applyCareerCatalog('gcc-2026-v1');

    const before = await db.select().from(careerCatalogEntries);
    const page = await careerKnowledgeProvider.listOccupations({ query: '校招', majorCode: 'major-se', city: '广州', limit: 1 });
    const after = await db.select().from(careerCatalogEntries);
    expect(page.pageInfo).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
    expect(page.items[0]).toMatchObject({ code: 'OCC-001', catalogVersion: 'gcc-2026-v1', aliases: ['软件开发工程师（校招）'] });
    expect(page.items[0].majorMappings?.[0]).toMatchObject({ majorCode: 'major-se', collegeCode: 'gcc-it', relevanceType: 'primary' });
    expect(page.filters.colleges).toEqual([{ value: 'gcc-it', label: '信息技术学院' }]);
    expect(page.filters.majors).toEqual([{ value: 'major-se', label: '软件工程 · 信息技术学院' }]);
    expect(page.filters.cities).toEqual(['广州']);
    expect(after).toHaveLength(before.length);
  });

  it('replays an immutable staged version for rollback while preserving direct legacy lookup', async () => {
    await stageCareerCatalog(bundle('gcc-2026-v1', 'OCC-OLD', '旧版岗位'));
    await applyCareerCatalog('gcc-2026-v1');
    await stageCareerCatalog(bundle('gcc-2026-v2', 'OCC-NEW', '新版岗位'));
    await applyCareerCatalog('gcc-2026-v2');

    expect((await careerKnowledgeProvider.listOccupations()).items.map((item) => item.code)).toEqual(['OCC-NEW']);
    expect((await careerKnowledgeProvider.getOccupationByCode('OCC-OLD'))?.name).toBe('旧版岗位');

    await rollbackCareerCatalog('gcc-2026-v1');
    expect((await careerKnowledgeProvider.listOccupations()).items.map((item) => item.code)).toEqual(['OCC-OLD']);
    expect(await careerKnowledgeProvider.getActiveCatalogVersion()).toBe('gcc-2026-v1');
  });

  it('keeps an active same-version restage idempotent and rejects changed content under that version', async () => {
    const input = bundle('gcc-2026-immutable', 'OCC-STABLE', '稳定岗位');
    await stageCareerCatalog(input);
    await applyCareerCatalog('gcc-2026-immutable');
    const beforeEntries = await db.select().from(careerCatalogEntries);

    await stageCareerCatalog(input);
    const active = await db.select().from(careerCatalogVersions);
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('active');
    expect(await db.select().from(careerCatalogEntries)).toEqual(beforeEntries);

    const changed = bundle('gcc-2026-immutable', 'OCC-STABLE', '被篡改的岗位');
    await expect(stageCareerCatalog(changed)).rejects.toThrow(/immutable/);
    expect((await db.select().from(careerCatalogVersions))[0].status).toBe('active');
  });

  it('rejects source references that are absent from sources.json', async () => {
    const input = bundle('gcc-2026-bad-source', 'OCC-BAD', '来源错误岗位');
    input.occupations.items[0].source_ids = ['missing-source'];
    const diff = await dryRunCareerCatalog(input);
    expect(diff.blockingErrors).toContain('Unknown source in occupation OCC-BAD: missing-source');
    await expect(stageCareerCatalog(input)).rejects.toThrow(/validation failed/);
  });
});
