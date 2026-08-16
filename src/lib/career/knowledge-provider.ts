import { and, count, eq, inArray, like, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import { careerCatalogCache, type CareerCatalogCache } from '@/lib/cache/career-catalog-cache';
import {
  careerKnowledgeDocuments,
  occupationRelations,
  occupationRequirements,
  occupations,
} from '@/lib/db/schema';
import {
  careerCatalogVersions,
  careerColleges,
  careerMajors,
  majorOccupationEdges,
  occupationAliases,
} from '@/lib/db/schema-career';
import type {
  KnowledgeSearchResult,
  OccupationDetail,
  OccupationListFilters,
  OccupationPage,
  OccupationSummary,
} from '@/types/career';
import { parseJson, toIso, toNullableIso } from './serialization';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

function boundedTtl(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 60 && parsed <= 86_400 ? parsed : fallback;
}

const LIST_CACHE_TTL_SECONDS = boundedTtl(process.env.CACHE_TTL_OCCUPATIONS, 600);
const DETAIL_CACHE_TTL_SECONDS = boundedTtl(process.env.CACHE_TTL_OCCUPATION_DETAIL, 900);

export interface CareerKnowledgeProvider {
  listOccupations(filters?: OccupationListFilters): Promise<OccupationPage>;
  getOccupationByCode(code: string): Promise<OccupationDetail | null>;
  search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]>;
  getActiveCatalogVersion(): Promise<string | null>;
  invalidateCache(): Promise<void>;
}

function normalizeQuery(query?: string): string {
  return query?.trim().toLocaleLowerCase('zh-CN') ?? '';
}

function stringList(value: unknown): string[] {
  return parseJson<string[]>(value, []).filter((item): item is string => typeof item === 'string');
}

function pageBounds(filters: OccupationListFilters) {
  return {
    limit: Math.max(1, Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)),
    offset: Math.max(0, filters.offset ?? 0),
  };
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function normalizedLike(column: SQLWrapper, value: string): SQL {
  return sql`lower(${column}) like ${`%${normalizeQuery(value)}%`}`;
}

function intersectCodeSet(current: Set<string> | null, values: Iterable<string>): Set<string> {
  const next = new Set(values);
  return current == null ? next : new Set([...current].filter((code) => next.has(code)));
}

export class SqlCareerKnowledgeProvider implements CareerKnowledgeProvider {
  constructor(private readonly cache: CareerCatalogCache = careerCatalogCache) {}

  private listCacheKey(filters: OccupationListFilters): string {
    return JSON.stringify([
      filters.query ?? '', filters.collegeCode ?? '', filters.majorCode ?? '',
      filters.relevanceType ?? '', filters.relationType ?? '', filters.jobFamily ?? '',
      filters.industry ?? '', filters.city ?? '', filters.educationLevel ?? '',
      filters.limit ?? DEFAULT_PAGE_SIZE, filters.offset ?? 0,
    ]);
  }

  async invalidateCache(): Promise<void> {
    await this.cache.invalidate();
  }

  async getActiveCatalogVersion(): Promise<string | null> {
    await dbReady;
    const rows = await db.select({ version: careerCatalogVersions.version })
      .from(careerCatalogVersions)
      .where(eq(careerCatalogVersions.status, 'active'))
      .limit(1);
    return rows[0]?.version ?? null;
  }

  async listOccupations(filters: OccupationListFilters = {}): Promise<OccupationPage> {
    await dbReady;
    const { limit, offset } = pageBounds(filters);
    const normalizedFilters = { ...filters, limit, offset };
    const cacheKey = `list:${this.listCacheKey(normalizedFilters)}`;
    const cached = await this.cache.get<OccupationPage>(cacheKey);
    if (cached) return cached;

    const normalized = normalizeQuery(filters.query);
    let candidateCodes: Set<string> | null = null;

    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      const [directMatches, aliasMatches] = await Promise.all([
        db.select({ code: occupations.code }).from(occupations).where(and(
          eq(occupations.active, true),
          or(
            normalizedLike(occupations.name, token),
            normalizedLike(occupations.category, token),
            normalizedLike(occupations.summary, token),
            normalizedLike(occupations.jobFamily, token),
            normalizedLike(occupations.industry, token),
          ),
        )),
        db.select({ code: occupationAliases.occupationCode }).from(occupationAliases)
          .innerJoin(occupations, eq(occupations.code, occupationAliases.occupationCode))
          .where(and(
            eq(occupationAliases.active, true),
            eq(occupations.active, true),
            normalizedLike(occupationAliases.alias, token),
          )),
      ]);
      candidateCodes = intersectCodeSet(candidateCodes, [
        ...directMatches.map((row: { code: string }) => row.code),
        ...aliasMatches.map((row: { code: string }) => row.code),
      ]);
    }

    if (filters.collegeCode || filters.majorCode || filters.relevanceType) {
      const mappingConditions: SQL[] = [
        eq(majorOccupationEdges.active, true),
        eq(careerMajors.active, true),
        eq(careerColleges.active, true),
        eq(occupations.active, true),
      ];
      if (filters.collegeCode) mappingConditions.push(eq(careerColleges.code, filters.collegeCode));
      if (filters.majorCode) mappingConditions.push(eq(careerMajors.code, filters.majorCode));
      if (filters.relevanceType) mappingConditions.push(eq(majorOccupationEdges.relationType, filters.relevanceType));
      const matchingMappings = await db.selectDistinct({ code: majorOccupationEdges.occupationCode })
        .from(majorOccupationEdges)
        .innerJoin(careerMajors, eq(careerMajors.code, majorOccupationEdges.majorCode))
        .innerJoin(careerColleges, eq(careerColleges.code, careerMajors.collegeCode))
        .innerJoin(occupations, eq(occupations.code, majorOccupationEdges.occupationCode))
        .where(and(...mappingConditions));
      candidateCodes = intersectCodeSet(
        candidateCodes,
        matchingMappings.flatMap((row: { code: string | null }) => row.code ? [row.code] : []),
      );
    }

    if (filters.relationType) {
      const relationMatches = await db.selectDistinct({ code: occupationRelations.fromCode })
        .from(occupationRelations)
        .innerJoin(occupations, eq(occupations.code, occupationRelations.fromCode))
        .where(and(eq(occupations.active, true), eq(occupationRelations.relationType, filters.relationType)));
      candidateCodes = intersectCodeSet(candidateCodes, relationMatches.map((row: { code: string }) => row.code));
    }

    const conditions: SQL[] = [eq(occupations.active, true)];
    if (filters.jobFamily) conditions.push(sql`lower(${occupations.jobFamily}) = ${normalizeQuery(filters.jobFamily)}`);
    if (filters.industry) conditions.push(sql`lower(${occupations.industry}) = ${normalizeQuery(filters.industry)}`);
    if (filters.city) conditions.push(like(occupations.cities, `%${JSON.stringify(filters.city)}%`));
    if (filters.educationLevel) conditions.push(like(occupations.educationLevels, `%${JSON.stringify(filters.educationLevel)}%`));
    if (candidateCodes) {
      conditions.push(candidateCodes.size > 0 ? inArray(occupations.code, [...candidateCodes]) : sql`1 = 0`);
    }
    const where = and(...conditions);

    const [countRows, occupationRows] = await Promise.all([
      db.select({ total: count() }).from(occupations).where(where),
      db.select().from(occupations).where(where).orderBy(occupations.code).limit(limit).offset(offset),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    const pageCodes = occupationRows.map((row: typeof occupations.$inferSelect) => row.code);

    const [aliasRows, mappingRows, requirementRows, facetOccupationRows, facetMappingRows, facetRelationRows] = await Promise.all([
      pageCodes.length
        ? db.select().from(occupationAliases).where(and(eq(occupationAliases.active, true), inArray(occupationAliases.occupationCode, pageCodes)))
        : Promise.resolve([]),
      pageCodes.length
        ? db.select({
            occupationCode: majorOccupationEdges.occupationCode,
            majorCode: careerMajors.code,
            majorName: careerMajors.name,
            collegeCode: careerColleges.code,
            collegeName: careerColleges.name,
            relevanceType: majorOccupationEdges.relationType,
          }).from(majorOccupationEdges)
            .innerJoin(careerMajors, eq(careerMajors.code, majorOccupationEdges.majorCode))
            .innerJoin(careerColleges, eq(careerColleges.code, careerMajors.collegeCode))
            .where(and(
              eq(majorOccupationEdges.active, true),
              eq(careerMajors.active, true),
              eq(careerColleges.active, true),
              inArray(majorOccupationEdges.occupationCode, pageCodes),
            ))
        : Promise.resolve([]),
      pageCodes.length
        ? db.selectDistinct({ occupationCode: occupationRequirements.occupationCode })
            .from(occupationRequirements).where(inArray(occupationRequirements.occupationCode, pageCodes))
        : Promise.resolve([]),
      db.select({
        jobFamily: occupations.jobFamily,
        industry: occupations.industry,
        cities: occupations.cities,
        educationLevels: occupations.educationLevels,
      }).from(occupations).where(eq(occupations.active, true)),
      db.selectDistinct({
        majorCode: careerMajors.code,
        majorName: careerMajors.name,
        collegeCode: careerColleges.code,
        collegeName: careerColleges.name,
        relevanceType: majorOccupationEdges.relationType,
      }).from(majorOccupationEdges)
        .innerJoin(careerMajors, eq(careerMajors.code, majorOccupationEdges.majorCode))
        .innerJoin(careerColleges, eq(careerColleges.code, careerMajors.collegeCode))
        .innerJoin(occupations, eq(occupations.code, majorOccupationEdges.occupationCode))
        .where(and(
          eq(majorOccupationEdges.active, true),
          eq(careerMajors.active, true),
          eq(careerColleges.active, true),
          eq(occupations.active, true),
        )),
      db.selectDistinct({ relationType: occupationRelations.relationType })
        .from(occupationRelations)
        .innerJoin(occupations, eq(occupations.code, occupationRelations.fromCode))
        .where(eq(occupations.active, true)),
    ]);

    const aliasesByOccupation = new Map<string, string[]>();
    for (const row of aliasRows) {
      const aliases = aliasesByOccupation.get(row.occupationCode) ?? [];
      aliases.push(row.alias);
      aliasesByOccupation.set(row.occupationCode, aliases);
    }
    const mappingsByOccupation = new Map<string, OccupationSummary['majorMappings']>();
    for (const row of mappingRows) {
      if (!row.occupationCode) continue;
      const mappings = mappingsByOccupation.get(row.occupationCode) ?? [];
      mappings.push({
        majorCode: row.majorCode,
        majorName: row.majorName,
        collegeCode: row.collegeCode,
        collegeName: row.collegeName,
        relevanceType: row.relevanceType,
      });
      mappingsByOccupation.set(row.occupationCode, mappings);
    }
    const occupationsWithRequirements = new Set(requirementRows.map((row: { occupationCode: string }) => row.occupationCode));
    const items: OccupationSummary[] = occupationRows.map((occupation: typeof occupations.$inferSelect) => ({
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      matchScore: null,
      jobFamily: occupation.jobFamily,
      industry: occupation.industry,
      cities: stringList(occupation.cities),
      educationLevels: stringList(occupation.educationLevels),
      catalogVersion: occupation.catalogVersion,
      aliases: aliasesByOccupation.get(occupation.code) ?? [],
      majorMappings: mappingsByOccupation.get(occupation.code) ?? [],
      canonicalType: occupation.canonicalType,
      reviewStatus: occupation.reviewStatus,
      scoringEligible: Boolean(occupation.scoringEligible) && occupationsWithRequirements.has(occupation.code),
    }));
    const collegeOptions = new Map<string, string>();
    const majorOptions = new Map<string, string>();
    for (const row of facetMappingRows) {
      collegeOptions.set(row.collegeCode, row.collegeName);
      majorOptions.set(row.majorCode, `${row.majorName} · ${row.collegeName}`);
    }

    const result: OccupationPage = {
      items,
      pageInfo: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
      filters: {
        ...filters,
        limit,
        offset,
        colleges: [...collegeOptions].map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        majors: [...majorOptions].map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        jobFamilies: uniqueSorted(facetOccupationRows.map((row: { jobFamily: string }) => row.jobFamily)),
        industries: uniqueSorted(facetOccupationRows.map((row: { industry: string }) => row.industry)),
        cities: uniqueSorted(facetOccupationRows.flatMap((row: { cities: unknown }) => stringList(row.cities))),
        educationLevels: uniqueSorted(facetOccupationRows.flatMap((row: { educationLevels: unknown }) => stringList(row.educationLevels))),
        relevanceTypes: uniqueSorted(facetMappingRows.map((row: { relevanceType: string }) => row.relevanceType)) as OccupationPage['filters']['relevanceTypes'],
        relationTypes: uniqueSorted(facetRelationRows.map((row: { relationType: string }) => row.relationType)) as OccupationPage['filters']['relationTypes'],
      },
    };
    await this.cache.set(cacheKey, result, LIST_CACHE_TTL_SECONDS);
    return result;
  }

  async getOccupationByCode(code: string): Promise<OccupationDetail | null> {
    await dbReady;
    const cacheKey = `detail:${code}`;
    const cached = await this.cache.get<OccupationDetail>(cacheKey);
    if (cached) return cached;
    // Direct lookup intentionally includes inactive rows so legacy J-* goals remain readable.
    const rows = await db.select().from(occupations).where(eq(occupations.code, code)).limit(1);
    const occupation = rows[0];
    if (!occupation) return null;

    const [rawRequirements, rawRelations, rawDocuments, rawAliases, rawEdges] = await Promise.all([
      db.select().from(occupationRequirements).where(eq(occupationRequirements.occupationCode, code)).orderBy(occupationRequirements.id),
      db.select().from(occupationRelations).where(eq(occupationRelations.fromCode, code)).orderBy(occupationRelations.id),
      db.select().from(careerKnowledgeDocuments).where(eq(careerKnowledgeDocuments.occupationCode, code)).orderBy(careerKnowledgeDocuments.id),
      db.select().from(occupationAliases).where(and(eq(occupationAliases.occupationCode, code), eq(occupationAliases.active, true))),
      db.select().from(majorOccupationEdges).where(and(eq(majorOccupationEdges.occupationCode, code), eq(majorOccupationEdges.active, true))),
    ]);
    const requirements = rawRequirements as Array<typeof occupationRequirements.$inferSelect>;
    const relations = rawRelations as Array<typeof occupationRelations.$inferSelect>;
    const documents = rawDocuments as Array<typeof careerKnowledgeDocuments.$inferSelect>;
    const aliases = rawAliases as Array<typeof occupationAliases.$inferSelect>;
    const edges = rawEdges as Array<typeof majorOccupationEdges.$inferSelect>;

    const relatedCodes = relations.map((relation) => relation.toCode);
    const rawRelatedRows = relatedCodes.length
      ? await db.select().from(occupations).where(inArray(occupations.code, relatedCodes))
      : [];
    const relatedRows = rawRelatedRows as Array<typeof occupations.$inferSelect>;
    const majorCodes = [...new Set(edges.map((edge) => edge.majorCode))];
    const rawMajors = majorCodes.length
      ? await db.select().from(careerMajors).where(and(eq(careerMajors.active, true), inArray(careerMajors.code, majorCodes)))
      : [];
    const majors = rawMajors as Array<typeof careerMajors.$inferSelect>;
    const collegeCodes = [...new Set(majors.map((major) => major.collegeCode))];
    const rawColleges = collegeCodes.length
      ? await db.select().from(careerColleges).where(and(eq(careerColleges.active, true), inArray(careerColleges.code, collegeCodes)))
      : [];
    const colleges = rawColleges as Array<typeof careerColleges.$inferSelect>;
    const relatedByCode = new Map(relatedRows.map((row) => [row.code, row]));
    const majorByCode = new Map(majors.map((row) => [row.code, row]));
    const collegeByCode = new Map(colleges.map((row) => [row.code, row]));

    const result: OccupationDetail = {
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      description: occupation.description,
      entryLevel: occupation.entryLevel,
      matchScore: null,
      jobFamily: occupation.jobFamily,
      industry: occupation.industry,
      cities: stringList(occupation.cities),
      educationLevels: stringList(occupation.educationLevels),
      catalogVersion: occupation.catalogVersion,
      aliases: aliases.map((item) => item.alias),
      majorMappings: edges.flatMap((edge) => {
        const major = majorByCode.get(edge.majorCode);
        const college = major ? collegeByCode.get(major.collegeCode) : undefined;
        return major && college ? [{
          majorCode: major.code,
          majorName: major.name,
          collegeCode: college.code,
          collegeName: college.name,
          relevanceType: edge.relationType,
        }] : [];
      }),
      canonicalType: occupation.canonicalType,
      reviewStatus: occupation.reviewStatus,
      scoringEligible: occupation.scoringEligible && requirements.length > 0,
      requirements: requirements.map((item) => ({
        abilityCode: item.abilityCode,
        abilityName: item.abilityName,
        dimension: item.dimension,
        targetScore: item.targetScore,
        weight: item.weight,
        required: item.required,
        description: item.description,
      })),
      relatedOccupations: relations.flatMap((relation) => {
        const target = relatedByCode.get(relation.toCode);
        return target ? [{ code: target.code, name: target.name, relationType: relation.relationType, description: relation.description }] : [];
      }),
      citations: documents.map((document) => ({
        id: document.id,
        title: document.title,
        sourceLabel: document.sourceLabel,
        sourceUrl: document.sourceUrl,
        excerpt: document.content.slice(0, 220),
        publishedAt: toNullableIso(document.publishedAt),
        verifiedAt: toIso(document.verifiedAt),
      })),
    };
    await this.cache.set(cacheKey, result, DETAIL_CACHE_TTL_SECONDS);
    return result;
  }

  async search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]> {
    await dbReady;
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 20));
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const textCondition = and(...tokens.map((token) => or(
      normalizedLike(careerKnowledgeDocuments.title, token),
      normalizedLike(careerKnowledgeDocuments.content, token),
    )));
    const whereCondition = options?.occupationCode
      ? and(eq(careerKnowledgeDocuments.occupationCode, options.occupationCode), textCondition)
      : textCondition;
    const rawRows = await db.select().from(careerKnowledgeDocuments)
      .where(whereCondition)
      .limit(limit * 4);
    const rows = rawRows as Array<typeof careerKnowledgeDocuments.$inferSelect>;

    return rows
      .map((document) => {
        const haystack = `${document.title} ${document.content}`.toLocaleLowerCase('zh-CN');
        const relevance = normalized.split(/\s+/).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
        return { document, relevance };
      })
      .filter(({ relevance }) => relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ document, relevance }) => ({
        occupationCode: document.occupationCode,
        content: document.content,
        citation: {
          id: document.id,
          title: document.title,
          sourceLabel: document.sourceLabel,
          sourceUrl: document.sourceUrl,
          excerpt: document.content.slice(0, 220),
          publishedAt: toNullableIso(document.publishedAt),
          verifiedAt: toIso(document.verifiedAt),
        },
        relevance,
      }));
  }
}

export const careerKnowledgeProvider: CareerKnowledgeProvider = new SqlCareerKnowledgeProvider();
