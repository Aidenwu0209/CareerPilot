import { and, eq, inArray, like, or } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
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
const LIST_CACHE_TTL_MS = 60_000;
const LIST_CACHE_MAX_ENTRIES = 64;

export interface CareerKnowledgeProvider {
  listOccupations(filters?: OccupationListFilters): Promise<OccupationPage>;
  getOccupationByCode(code: string): Promise<OccupationDetail | null>;
  search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]>;
  getActiveCatalogVersion(): Promise<string | null>;
  invalidateCache(): void;
}

function normalizeQuery(query?: string): string {
  return query?.trim().toLocaleLowerCase('zh-CN') ?? '';
}

function stringList(value: unknown): string[] {
  return parseJson<string[]>(value, []).filter((item): item is string => typeof item === 'string');
}

function includesValue(values: string[], expected?: string): boolean {
  if (!expected) return true;
  const normalized = normalizeQuery(expected);
  return values.some((value) => normalizeQuery(value) === normalized);
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

export class SqlCareerKnowledgeProvider implements CareerKnowledgeProvider {
  private readonly listCache = new Map<string, { expiresAt: number; value: OccupationPage }>();

  private listCacheKey(filters: OccupationListFilters): string {
    return JSON.stringify([
      filters.query ?? '', filters.collegeCode ?? '', filters.majorCode ?? '',
      filters.relevanceType ?? '', filters.relationType ?? '', filters.jobFamily ?? '',
      filters.industry ?? '', filters.city ?? '', filters.educationLevel ?? '',
      filters.limit ?? DEFAULT_PAGE_SIZE, filters.offset ?? 0,
    ]);
  }

  private cacheListResult(key: string, value: OccupationPage): OccupationPage {
    if (this.listCache.size >= LIST_CACHE_MAX_ENTRIES) {
      const oldestKey = this.listCache.keys().next().value;
      if (oldestKey) this.listCache.delete(oldestKey);
    }
    this.listCache.set(key, { expiresAt: Date.now() + LIST_CACHE_TTL_MS, value });
    return value;
  }

  invalidateCache(): void {
    this.listCache.clear();
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
    const cacheKey = this.listCacheKey(filters);
    const cached = this.listCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.listCache.delete(cacheKey);
    const { limit, offset } = pageBounds(filters);
    const normalized = normalizeQuery(filters.query);
    const [rawOccupationRows, rawAliasRows, rawEdgeRows, rawMajorRows, rawCollegeRows, rawRequirementRows, rawRelationRows] = await Promise.all([
      db.select().from(occupations).where(eq(occupations.active, true)).orderBy(occupations.code),
      db.select().from(occupationAliases).where(eq(occupationAliases.active, true)),
      db.select().from(majorOccupationEdges).where(eq(majorOccupationEdges.active, true)),
      db.select().from(careerMajors).where(eq(careerMajors.active, true)),
      db.select().from(careerColleges).where(eq(careerColleges.active, true)),
      db.select({ occupationCode: occupationRequirements.occupationCode }).from(occupationRequirements),
      db.select().from(occupationRelations),
    ]);
    const occupationRows = rawOccupationRows as Array<typeof occupations.$inferSelect>;
    const aliasRows = rawAliasRows as Array<typeof occupationAliases.$inferSelect>;
    const edgeRows = rawEdgeRows as Array<typeof majorOccupationEdges.$inferSelect>;
    const majorRows = rawMajorRows as Array<typeof careerMajors.$inferSelect>;
    const collegeRows = rawCollegeRows as Array<typeof careerColleges.$inferSelect>;
    const requirementRows = rawRequirementRows as Array<{ occupationCode: string }>;
    const relationRows = rawRelationRows as Array<typeof occupationRelations.$inferSelect>;
    const activeOccupationCodes = new Set(occupationRows.map((row) => row.code));
    const connectedEdgeRows = edgeRows.filter((row) => row.occupationCode && activeOccupationCodes.has(row.occupationCode));
    const connectedMajorCodes = new Set(connectedEdgeRows.map((row) => row.majorCode));
    const connectedMajorRows = majorRows.filter((row) => connectedMajorCodes.has(row.code));
    const connectedCollegeCodes = new Set(connectedMajorRows.map((row) => row.collegeCode));
    const connectedCollegeRows = collegeRows.filter((row) => connectedCollegeCodes.has(row.code));
    const activeRelationRows = relationRows.filter((row) => activeOccupationCodes.has(row.fromCode) && activeOccupationCodes.has(row.toCode));
    const occupationsWithRequirements = new Set(requirementRows.map((row) => row.occupationCode));

    const aliasesByOccupation = new Map<string, string[]>();
    for (const row of aliasRows) {
      const current = aliasesByOccupation.get(row.occupationCode) ?? [];
      current.push(row.alias);
      aliasesByOccupation.set(row.occupationCode, current);
    }
    const majorByCode = new Map(majorRows.map((row) => [row.code, row]));
    const collegeByCode = new Map(collegeRows.map((row) => [row.code, row]));
    const edgesByOccupation = new Map<string, typeof edgeRows>();
    for (const row of connectedEdgeRows) {
      if (!row.occupationCode) continue;
      const current = edgesByOccupation.get(row.occupationCode) ?? [];
      current.push(row);
      edgesByOccupation.set(row.occupationCode, current);
    }

    const mapped: OccupationSummary[] = occupationRows.map((occupation) => {
      const aliases = aliasesByOccupation.get(occupation.code) ?? [];
      const mappings = (edgesByOccupation.get(occupation.code) ?? []).flatMap((edge) => {
        const major = majorByCode.get(edge.majorCode);
        const college = major ? collegeByCode.get(major.collegeCode) : undefined;
        if (!major || !college) return [];
        return [{
          majorCode: major.code,
          majorName: major.name,
          collegeCode: college.code,
          collegeName: college.name,
          relevanceType: edge.relationType,
        }];
      });
      return {
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
        aliases,
        majorMappings: mappings,
        canonicalType: occupation.canonicalType,
        reviewStatus: occupation.reviewStatus,
        scoringEligible: occupation.scoringEligible && occupationsWithRequirements.has(occupation.code),
      };
    });

    type FacetKey = 'collegeCode' | 'majorCode' | 'relevanceType' | 'relationType' | 'jobFamily' | 'industry' | 'city' | 'educationLevel';
    const relationsByFromCode = new Map<string, typeof activeRelationRows>();
    for (const relation of activeRelationRows) {
      const current = relationsByFromCode.get(relation.fromCode) ?? [];
      current.push(relation);
      relationsByFromCode.set(relation.fromCode, current);
    }
    const matchesFilters = (occupation: OccupationSummary, omit?: FacetKey) => {
      const mappings = occupation.majorMappings ?? [];
      const haystack = `${occupation.name} ${occupation.category} ${occupation.summary} ${occupation.jobFamily ?? ''} ${occupation.industry ?? ''} ${(occupation.aliases ?? []).join(' ')}`.toLocaleLowerCase('zh-CN');
      return (!normalized || normalized.split(/\s+/).every((token) => haystack.includes(token)))
        && (omit === 'collegeCode' || !filters.collegeCode || mappings.some((item) => item.collegeCode === filters.collegeCode))
        && (omit === 'majorCode' || !filters.majorCode || mappings.some((item) => item.majorCode === filters.majorCode))
        && (omit === 'relevanceType' || !filters.relevanceType || mappings.some((item) => item.relevanceType === filters.relevanceType))
        && (omit === 'jobFamily' || !filters.jobFamily || normalizeQuery(occupation.jobFamily) === normalizeQuery(filters.jobFamily))
        && (omit === 'industry' || !filters.industry || normalizeQuery(occupation.industry) === normalizeQuery(filters.industry))
        && (omit === 'city' || includesValue(occupation.cities ?? [], filters.city))
        && (omit === 'educationLevel' || includesValue(occupation.educationLevels ?? [], filters.educationLevel))
        && (omit === 'relationType' || !filters.relationType || (relationsByFromCode.get(occupation.code) ?? []).some((item) => item.relationType === filters.relationType));
    };
    const relationFiltered = mapped.filter((occupation) => matchesFilters(occupation));
    const facetOccupations = (omit: FacetKey) => mapped.filter((occupation) => matchesFilters(occupation, omit));
    const collegeFacetCodes = new Set(facetOccupations('collegeCode').flatMap((item) => item.majorMappings?.map((mapping) => mapping.collegeCode) ?? []));
    const majorFacetCodes = new Set(facetOccupations('majorCode').flatMap((item) => item.majorMappings?.map((mapping) => mapping.majorCode) ?? []));

    return this.cacheListResult(cacheKey, {
      items: relationFiltered.slice(offset, offset + limit),
      pageInfo: {
        limit,
        offset,
        total: relationFiltered.length,
        hasMore: offset + limit < relationFiltered.length,
      },
      filters: {
        ...filters,
        limit,
        offset,
        colleges: connectedCollegeRows.filter((item) => collegeFacetCodes.has(item.code))
          .map((item) => ({ value: item.code, label: item.name }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        majors: connectedMajorRows.filter((item) => majorFacetCodes.has(item.code))
          .map((item) => ({
            value: item.code,
            label: `${item.name} · ${collegeByCode.get(item.collegeCode)?.name ?? item.collegeCode}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        jobFamilies: uniqueSorted(facetOccupations('jobFamily').map((item) => item.jobFamily)),
        industries: uniqueSorted(facetOccupations('industry').map((item) => item.industry)),
        cities: uniqueSorted(facetOccupations('city').flatMap((item) => item.cities ?? [])),
        educationLevels: uniqueSorted(facetOccupations('educationLevel').flatMap((item) => item.educationLevels ?? [])),
        relevanceTypes: uniqueSorted(facetOccupations('relevanceType').flatMap((item) => item.majorMappings?.map((mapping) => mapping.relevanceType) ?? [])) as OccupationPage['filters']['relevanceTypes'],
        relationTypes: uniqueSorted(facetOccupations('relationType').flatMap((item) => (relationsByFromCode.get(item.code) ?? []).map((relation) => relation.relationType))) as OccupationPage['filters']['relationTypes'],
      },
    });
  }

  async getOccupationByCode(code: string): Promise<OccupationDetail | null> {
    await dbReady;
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

    return {
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
  }

  async search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]> {
    await dbReady;
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 20));
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const tokenConditions = tokens.flatMap((token) => [
      like(careerKnowledgeDocuments.title, `%${token}%`),
      like(careerKnowledgeDocuments.content, `%${token}%`),
    ]);
    const textCondition = or(...tokenConditions);
    const whereCondition = options?.occupationCode
      ? and(eq(careerKnowledgeDocuments.occupationCode, options.occupationCode), textCondition)
      : textCondition;
    const rawRows = await db.select().from(careerKnowledgeDocuments)
      .where(whereCondition)
      .limit(Math.max(100, limit * 20));
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
