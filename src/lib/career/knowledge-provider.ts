import { and, eq } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import {
  careerKnowledgeDocuments,
  occupationRelations,
  occupationRequirements,
  occupations,
} from '@/lib/db/schema';
import type {
  KnowledgeSearchResult,
  OccupationDetail,
  OccupationSummary,
} from '@/types/career';
import { DEMO_OCCUPATIONS, DEMO_OCCUPATION_BY_CODE } from './catalog';
import { toIso, toNullableIso } from './serialization';

export interface CareerKnowledgeProvider {
  listOccupations(query?: string): Promise<OccupationSummary[]>;
  getOccupationByCode(code: string): Promise<OccupationDetail | null>;
  search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]>;
}

let catalogInitialization: Promise<void> | null = null;

export async function ensureCareerCatalog(): Promise<void> {
  if (catalogInitialization) return catalogInitialization;

  catalogInitialization = (async () => {
    await dbReady;

    for (const occupation of DEMO_OCCUPATIONS) {
      await db.insert(occupations).values({
        code: occupation.code,
        name: occupation.name,
        category: occupation.category,
        summary: occupation.summary,
        description: occupation.description,
        entryLevel: occupation.entryLevel,
        active: true,
      } as never).onConflictDoUpdate({
        target: occupations.code,
        set: {
          name: occupation.name,
          category: occupation.category,
          summary: occupation.summary,
          description: occupation.description,
          entryLevel: occupation.entryLevel,
          active: true,
          updatedAt: new Date(),
        },
      });
    }

    for (const occupation of DEMO_OCCUPATIONS) {
      for (const requirement of occupation.requirements) {
        await db.insert(occupationRequirements).values({
          id: `requirement:${occupation.code}:${requirement.abilityCode}`,
          occupationCode: occupation.code,
          ...requirement,
        } as never).onConflictDoUpdate({
          target: [occupationRequirements.occupationCode, occupationRequirements.abilityCode],
          set: {
            abilityName: requirement.abilityName,
            dimension: requirement.dimension,
            targetScore: requirement.targetScore,
            weight: requirement.weight,
            required: requirement.required,
            description: requirement.description,
          },
        });
      }

      for (const relation of occupation.relations) {
        await db.insert(occupationRelations).values({
          id: `relation:${occupation.code}:${relation.toCode}:${relation.relationType}`,
          fromCode: occupation.code,
          ...relation,
        } as never).onConflictDoUpdate({
          target: [occupationRelations.fromCode, occupationRelations.toCode, occupationRelations.relationType],
          set: { description: relation.description },
        });
      }

      for (const source of occupation.citations) {
        await db.insert(careerKnowledgeDocuments).values({
          id: source.id,
          occupationCode: occupation.code,
          title: source.title,
          content: `${occupation.description}\n${occupation.requirements.map((item) => `${item.abilityName}：${item.description}`).join('\n')}`,
          sourceLabel: source.sourceLabel,
          sourceUrl: source.sourceUrl,
          publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
          verifiedAt: new Date(source.verifiedAt),
          metadata: { catalogVersion: 1, manuallyCurated: true },
        } as never).onConflictDoUpdate({
          target: careerKnowledgeDocuments.id,
          set: {
            occupationCode: occupation.code,
            title: source.title,
            content: `${occupation.description}\n${occupation.requirements.map((item) => `${item.abilityName}：${item.description}`).join('\n')}`,
            sourceLabel: source.sourceLabel,
            sourceUrl: source.sourceUrl,
            publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
            verifiedAt: new Date(source.verifiedAt),
            metadata: { catalogVersion: 1, manuallyCurated: true },
          },
        });
      }
    }
  })().catch((error) => {
    catalogInitialization = null;
    throw error;
  });

  return catalogInitialization;
}

function normalizeQuery(query?: string): string {
  return query?.trim().toLocaleLowerCase('zh-CN') ?? '';
}

function matchesOccupation(occupation: Pick<OccupationSummary, 'name' | 'category' | 'summary'>, query: string): boolean {
  if (!query) return true;
  return `${occupation.name} ${occupation.category} ${occupation.summary}`
    .toLocaleLowerCase('zh-CN')
    .includes(query);
}

export class InMemoryCareerKnowledgeProvider implements CareerKnowledgeProvider {
  async listOccupations(query?: string): Promise<OccupationSummary[]> {
    const normalized = normalizeQuery(query);
    return DEMO_OCCUPATIONS
      .filter((occupation) => matchesOccupation(occupation, normalized))
      .map((occupation) => ({
        code: occupation.code,
        name: occupation.name,
        category: occupation.category,
        summary: occupation.summary,
        matchScore: null,
      }));
  }

  async getOccupationByCode(code: string): Promise<OccupationDetail | null> {
    const occupation = DEMO_OCCUPATION_BY_CODE.get(code);
    if (!occupation) return null;
    return {
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      description: occupation.description,
      entryLevel: occupation.entryLevel,
      matchScore: null,
      requirements: occupation.requirements,
      relatedOccupations: occupation.relations.flatMap((relation) => {
        const target = DEMO_OCCUPATION_BY_CODE.get(relation.toCode);
        return target ? [{ code: target.code, name: target.name, relationType: relation.relationType, description: relation.description }] : [];
      }),
      citations: occupation.citations,
    };
  }

  async search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]> {
    const normalized = normalizeQuery(query);
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 20));
    return DEMO_OCCUPATIONS
      .filter((occupation) => !options?.occupationCode || occupation.code === options.occupationCode)
      .map((occupation) => {
        const haystack = `${occupation.name} ${occupation.description} ${occupation.requirements.map((item) => `${item.abilityName} ${item.description}`).join(' ')}`.toLocaleLowerCase('zh-CN');
        const relevance = normalized ? normalized.split(/\s+/).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0) : 1;
        return { occupation, relevance };
      })
      .filter(({ relevance }) => relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ occupation, relevance }) => ({
        occupationCode: occupation.code,
        content: occupation.description,
        citation: occupation.citations[0],
        relevance,
      }));
  }
}

export class SqlCareerKnowledgeProvider implements CareerKnowledgeProvider {
  async listOccupations(query?: string): Promise<OccupationSummary[]> {
    await ensureCareerCatalog();
    const normalized = normalizeQuery(query);
    const rows = await db.select().from(occupations).where(eq(occupations.active, true)).orderBy(occupations.code);
    return rows
      .filter((occupation: typeof rows[number]) => matchesOccupation(occupation, normalized))
      .map((occupation: typeof rows[number]) => ({
        code: occupation.code,
        name: occupation.name,
        category: occupation.category,
        summary: occupation.summary,
        matchScore: null,
      }));
  }

  async getOccupationByCode(code: string): Promise<OccupationDetail | null> {
    await ensureCareerCatalog();
    const rows = await db.select().from(occupations).where(and(eq(occupations.code, code), eq(occupations.active, true))).limit(1);
    const occupation = rows[0];
    if (!occupation) return null;

    const [requirements, relations, documents] = await Promise.all([
      db.select().from(occupationRequirements).where(eq(occupationRequirements.occupationCode, code)).orderBy(occupationRequirements.id),
      db.select().from(occupationRelations).where(eq(occupationRelations.fromCode, code)).orderBy(occupationRelations.id),
      db.select().from(careerKnowledgeDocuments).where(eq(careerKnowledgeDocuments.occupationCode, code)).orderBy(careerKnowledgeDocuments.id),
    ]);

    const relatedCodes = relations.map((relation: typeof relations[number]) => relation.toCode);
    const relatedRows = (relatedCodes.length
      ? (await db.select().from(occupations)).filter((candidate: typeof occupation) => relatedCodes.includes(candidate.code))
      : []) as Array<typeof occupations.$inferSelect>;
    const relatedByCode = new Map<string, typeof occupations.$inferSelect>(relatedRows.map((row) => [row.code, row]));

    return {
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      description: occupation.description,
      entryLevel: occupation.entryLevel,
      matchScore: null,
      requirements: requirements.map((item: typeof requirements[number]) => ({
        abilityCode: item.abilityCode,
        abilityName: item.abilityName,
        dimension: item.dimension,
        targetScore: item.targetScore,
        weight: item.weight,
        required: item.required,
        description: item.description,
      })),
      relatedOccupations: relations.flatMap((relation: typeof relations[number]) => {
        const target = relatedByCode.get(relation.toCode);
        return target ? [{ code: target.code, name: target.name, relationType: relation.relationType, description: relation.description }] : [];
      }),
      citations: documents.map((document: typeof documents[number]) => ({
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
    await ensureCareerCatalog();
    const normalized = normalizeQuery(query);
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 20));
    const rows = options?.occupationCode
      ? await db.select().from(careerKnowledgeDocuments).where(eq(careerKnowledgeDocuments.occupationCode, options.occupationCode))
      : await db.select().from(careerKnowledgeDocuments);

    return rows
      .map((document: typeof rows[number]) => {
        const haystack = `${document.title} ${document.content}`.toLocaleLowerCase('zh-CN');
        const relevance = normalized ? normalized.split(/\s+/).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0) : 1;
        return { document, relevance };
      })
      .filter(({ relevance }: { relevance: number }) => relevance > 0)
      .sort((a: { relevance: number }, b: { relevance: number }) => b.relevance - a.relevance)
      .slice(0, limit)
      .map(({ document, relevance }: { document: typeof rows[number]; relevance: number }) => ({
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

export class DefaultCareerKnowledgeProvider implements CareerKnowledgeProvider {
  constructor(
    private readonly sqlProvider = new SqlCareerKnowledgeProvider(),
    private readonly fallbackProvider = new InMemoryCareerKnowledgeProvider(),
  ) {}

  async listOccupations(query?: string): Promise<OccupationSummary[]> {
    try {
      return await this.sqlProvider.listOccupations(query);
    } catch (error) {
      console.warn('[CareerKnowledge] SQL list failed; using reviewed in-memory catalog.', error);
      return this.fallbackProvider.listOccupations(query);
    }
  }

  async getOccupationByCode(code: string): Promise<OccupationDetail | null> {
    try {
      return await this.sqlProvider.getOccupationByCode(code);
    } catch (error) {
      console.warn('[CareerKnowledge] SQL lookup failed; using reviewed in-memory catalog.', error);
      return this.fallbackProvider.getOccupationByCode(code);
    }
  }

  async search(query: string, options?: { occupationCode?: string; limit?: number }): Promise<KnowledgeSearchResult[]> {
    try {
      return await this.sqlProvider.search(query, options);
    } catch (error) {
      console.warn('[CareerKnowledge] SQL search failed; using reviewed in-memory catalog.', error);
      return this.fallbackProvider.search(query, options);
    }
  }
}

export const careerKnowledgeProvider: CareerKnowledgeProvider = new DefaultCareerKnowledgeProvider();
