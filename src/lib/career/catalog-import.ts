import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import { config } from '@/lib/config';
import {
  careerGoals,
  careerKnowledgeDocuments,
  careerTasks,
  occupationRelations,
  occupationRequirements,
  occupations,
} from '@/lib/db/schema';
import {
  careerCatalogEntries,
  careerCatalogVersions,
  careerColleges,
  careerMajors,
  careerSourceSnapshots,
  majorOccupationEdges,
  occupationAliases,
} from '@/lib/db/schema-career';

type ReviewStatus = 'pending' | 'reviewed' | 'approved' | 'rejected' | string;

interface CatalogEnvelope<T> {
  schema_version: string;
  catalog_version: string;
  generated_at: string;
  items: T[];
}

interface CollegeInput { id: string; name: string; source_ids?: string[]; review_status?: ReviewStatus }
interface MajorInput {
  id: string; college_id: string; name: string; degree_level?: string;
  is_currently_recruiting?: boolean; admission_year?: number | null; source_ids?: string[];
  source_excerpt?: string; employment_text?: string; review_status?: ReviewStatus;
}
interface OccupationInput {
  code: string; name: string; canonical_type?: 'national_occupation' | 'standard_occupation' | 'market_alias' | 'unresolved_placeholder';
  category?: string; summary?: string; description?: string; entry_level?: string; job_family?: string;
  industry?: string; cities?: string[]; education_levels?: string[]; source_ids?: string[];
  review_status?: ReviewStatus; scoring_eligible?: boolean;
}
interface AliasInput { id: string; occupation_code: string; alias: string; source_ids?: string[]; review_status?: ReviewStatus }
interface EdgeInput {
  id: string; major_id: string; occupation_code?: string | null; proposed_title?: string | null;
  relation_type: 'primary' | 'adjacent' | 'cross_major' | 'stretch'; source_ids?: string[];
  evidence_excerpt?: string; review_required?: boolean; review_reason?: string;
}
interface RequirementInput {
  id: string; occupation_code: string; ability_code: string; ability_name: string;
  dimension: 'domain_knowledge' | 'professional_skills' | 'project_practice' | 'general_competencies' | 'job_readiness' | 'growth_potential';
  target_score?: number | null; weight?: number | null; required?: boolean; description?: string;
  education_level?: string; experience_level?: string; region?: string; source_ids?: string[];
  review_status?: ReviewStatus;
  requirement_type?: 'skill' | 'knowledge';
}
interface OccupationRelationInput {
  id: string; from_code: string; to_code: string;
  relation_type: 'progresses_to' | 'transfers_to' | 'related_to';
  description?: string; source_ids?: string[]; review_status?: ReviewStatus;
}
interface SourceInput {
  id: string; url: string; title: string; publisher?: string; source_type?: string;
  published_at?: string | null; fetched_at?: string | null; content_sha256: string;
  http_status?: number | null; robots_status?: string; license_notes?: string;
}
interface LegacyMapInput { old_code: string; new_code?: string | null; review_required?: boolean; reason?: string }

export interface CareerCatalogBundle {
  colleges: CatalogEnvelope<CollegeInput>;
  majors: CatalogEnvelope<MajorInput>;
  occupations: CatalogEnvelope<OccupationInput>;
  occupation_aliases: CatalogEnvelope<AliasInput>;
  major_occupation_edges: CatalogEnvelope<EdgeInput>;
  occupation_requirements: CatalogEnvelope<RequirementInput>;
  occupation_relations: CatalogEnvelope<OccupationRelationInput>;
  sources: CatalogEnvelope<SourceInput>;
  legacy_occupation_map?: CatalogEnvelope<LegacyMapInput>;
  manifest?: Record<string, unknown>;
}

export interface CatalogDiff {
  version: string;
  activeVersion: string | null;
  counts: Record<string, number>;
  occupations: { added: string[]; retained: string[]; deprecated: string[] };
  blockingErrors: string[];
  warnings: string[];
}

const ENTITY_KEYS = [
  'colleges', 'majors', 'occupations', 'occupation_aliases',
  'major_occupation_edges', 'occupation_requirements', 'occupation_relations', 'sources', 'legacy_occupation_map',
] as const;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function inputId(entityType: string, item: Record<string, unknown>, index: number): string {
  return String(item.id ?? item.code ?? item.old_code ?? `${entityType}:${index}`);
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertBundle(bundle: CareerCatalogBundle): { version: string; schemaVersion: string; errors: string[]; warnings: string[] } {
  const required = ENTITY_KEYS.filter((key) => key !== 'legacy_occupation_map');
  const envelopes = required.map((key) => bundle[key]);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (envelopes.some((envelope) => !envelope || !Array.isArray(envelope.items))) {
    errors.push('Every required catalog file must use the schema_version/catalog_version/generated_at/items envelope.');
  }
  const versions = new Set(envelopes.filter(Boolean).map((item) => item.catalog_version));
  const schemas = new Set(envelopes.filter(Boolean).map((item) => item.schema_version));
  if (versions.size !== 1) errors.push('All catalog files must have the same catalog_version.');
  if (schemas.size !== 1) errors.push('All catalog files must have the same schema_version.');
  const version = [...versions][0] ?? '';
  const schemaVersion = [...schemas][0] ?? '';
  if (schemaVersion !== '1.0.0') errors.push(`Unsupported catalog schema_version: ${schemaVersion || '(missing)'}.`);
  const manifest = (bundle.manifest ?? {}) as Record<string, unknown>;
  const publicationStatus = manifest.publication_status;
  const scoringSafe = manifest.scoring_safe === true;
  if (typeof publicationStatus !== 'string') errors.push('Manifest publication_status is required.');
  if (scoringSafe && publicationStatus !== 'approved') {
    errors.push('Manifest scoring_safe=true requires publication_status=approved.');
  }

  const occupationCodes = new Set(bundle.occupations?.items.map((item) => item.code) ?? []);
  const majorCodes = new Set(bundle.majors?.items.map((item) => item.id) ?? []);
  const sourceIds = new Set(bundle.sources?.items.map((item) => item.id) ?? []);
  const validateSources = (entity: string, id: string, references?: string[]) => {
    for (const sourceId of references ?? []) {
      if (!sourceIds.has(sourceId)) errors.push(`Unknown source in ${entity} ${id}: ${sourceId}`);
    }
  };
  for (const item of bundle.colleges?.items ?? []) validateSources('college', item.id, item.source_ids);
  for (const item of bundle.majors?.items ?? []) validateSources('major', item.id, item.source_ids);
  for (const item of bundle.occupations?.items ?? []) {
    validateSources('occupation', item.code, item.source_ids);
    if (!item.source_ids?.length) errors.push(`Occupation ${item.code} must cite at least one source.`);
    if (item.canonical_type === 'unresolved_placeholder' && item.scoring_eligible === true) {
      errors.push(`Unresolved placeholder ${item.code} cannot be scoring eligible.`);
    }
    if (item.review_status !== 'approved' && item.scoring_eligible === true) {
      errors.push(`Non-approved occupation ${item.code} cannot be scoring eligible.`);
    }
  }
  for (const item of bundle.occupation_aliases?.items ?? []) validateSources('occupation alias', item.id, item.source_ids);
  for (const edge of bundle.major_occupation_edges?.items ?? []) {
    if (!majorCodes.has(edge.major_id)) errors.push(`Unknown major in edge ${edge.id}: ${edge.major_id}`);
    if (edge.occupation_code && !occupationCodes.has(edge.occupation_code)) errors.push(`Unknown occupation in edge ${edge.id}: ${edge.occupation_code}`);
    if (!edge.occupation_code && !edge.review_required) errors.push(`Unresolved edge ${edge.id} must require review.`);
    validateSources('major occupation edge', edge.id, edge.source_ids);
  }
  for (const requirement of bundle.occupation_requirements?.items ?? []) {
    if (!occupationCodes.has(requirement.occupation_code)) errors.push(`Unknown occupation in requirement ${requirement.id}.`);
    if (requirement.target_score == null || requirement.weight == null) warnings.push(`Requirement ${requirement.id} is informational and will not be scored.`);
    validateSources('occupation requirement', requirement.id, requirement.source_ids);
  }
  const requirementCountByOccupation = new Map<string, number>();
  for (const requirement of bundle.occupation_requirements?.items ?? []) {
    if (typeof requirement.target_score !== 'number' || typeof requirement.weight !== 'number') continue;
    requirementCountByOccupation.set(requirement.occupation_code, (requirementCountByOccupation.get(requirement.occupation_code) ?? 0) + 1);
  }
  for (const occupation of bundle.occupations?.items ?? []) {
    if (occupation.scoring_eligible === true && !requirementCountByOccupation.get(occupation.code)) {
      errors.push(`Scoring occupation ${occupation.code} must have at least one scorable requirement.`);
    }
  }
  for (const relation of bundle.occupation_relations?.items ?? []) {
    if (!occupationCodes.has(relation.from_code)) errors.push(`Unknown from occupation in relation ${relation.id}: ${relation.from_code}`);
    if (!occupationCodes.has(relation.to_code)) errors.push(`Unknown to occupation in relation ${relation.id}: ${relation.to_code}`);
    validateSources('occupation relation', relation.id, relation.source_ids);
  }
  return { version, schemaVersion, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export async function dryRunCareerCatalog(bundle: CareerCatalogBundle): Promise<CatalogDiff> {
  await dbReady;
  const validation = assertBundle(bundle);
  const [rawActiveVersionRows, rawActiveOccupationRows] = await Promise.all([
    db.select({ version: careerCatalogVersions.version }).from(careerCatalogVersions)
      .where(eq(careerCatalogVersions.status, 'active')).limit(1),
    db.select({ code: occupations.code }).from(occupations).where(eq(occupations.active, true)),
  ]);
  const activeVersionRows = rawActiveVersionRows as Array<{ version: string }>;
  const activeOccupationRows = rawActiveOccupationRows as Array<{ code: string }>;
  const incoming = new Set<string>(bundle.occupations?.items.map((item: OccupationInput) => item.code) ?? []);
  const active = new Set(activeOccupationRows.map((item) => item.code));
  const counts = Object.fromEntries(ENTITY_KEYS.map((key) => [key, bundle[key]?.items.length ?? 0]));
  return {
    version: validation.version,
    activeVersion: activeVersionRows[0]?.version ?? null,
    counts,
    occupations: {
      added: [...incoming].filter((code) => !active.has(code)).sort(),
      retained: [...incoming].filter((code) => active.has(code)).sort(),
      deprecated: [...active].filter((code) => !incoming.has(code)).sort(),
    },
    blockingErrors: validation.errors,
    warnings: validation.warnings,
  };
}

function stageStatements(
  tx: typeof db,
  bundle: CareerCatalogBundle,
  versionId: string,
  version: string,
  schemaVersion: string,
  bundleHash: string,
) {
  const statements: any[] = [
    tx.insert(careerCatalogVersions).values({
      id: versionId,
      version,
      schemaVersion,
      status: 'staged',
      manifestHash: bundleHash,
      metadata: bundle.manifest ?? {},
    } as never),
  ];
  for (const entityType of ENTITY_KEYS) {
    const envelope = bundle[entityType];
    if (!envelope) continue;
    envelope.items.forEach((raw, index) => {
      const item = raw as unknown as Record<string, unknown>;
      const externalId = inputId(entityType, item, index);
      statements.push(tx.insert(careerCatalogEntries).values({
        id: `${versionId}:${entityType}:${externalId}`,
        catalogVersionId: versionId,
        entityType,
        externalId,
        payload: item,
        contentHash: hash(item),
      } as never).onConflictDoUpdate({
        target: [careerCatalogEntries.catalogVersionId, careerCatalogEntries.entityType, careerCatalogEntries.externalId],
        set: { payload: item, contentHash: hash(item) },
      }));
    });
  }
  return statements;
}

async function runStatementsInTransaction(build: (tx: typeof db) => any[]): Promise<void> {
  const isSync = config.db.type === 'sqlite' || db.session?.constructor?.name === 'BetterSQLiteSession';
  if (isSync) {
    db.transaction((tx: typeof db) => {
      for (const statement of build(tx)) statement.run();
    });
    return;
  }
  await db.transaction(async (tx: typeof db) => {
    for (const statement of build(tx)) await statement;
  });
}

export async function stageCareerCatalog(bundle: CareerCatalogBundle): Promise<CatalogDiff> {
  const diff = await dryRunCareerCatalog(bundle);
  if (diff.blockingErrors.length) throw new Error(`Catalog validation failed: ${diff.blockingErrors.join(' ')}`);
  const schemaVersion = bundle.occupations.schema_version;
  const versionId = `career-catalog:${diff.version}`;
  const bundleHash = hash(bundle);
  const existingRows = await db.select({
    id: careerCatalogVersions.id,
    status: careerCatalogVersions.status,
    manifestHash: careerCatalogVersions.manifestHash,
  }).from(careerCatalogVersions).where(eq(careerCatalogVersions.version, diff.version)).limit(1) as Array<{
    id: string;
    status: 'staged' | 'active' | 'archived' | 'failed';
    manifestHash: string;
  }>;
  const existing = existingRows[0];
  if (existing) {
    if (existing.manifestHash !== bundleHash) {
      throw new Error(`Catalog version ${diff.version} is immutable and already exists with different content.`);
    }
    // Idempotent restaging never changes active/archive state or immutable entries.
    return diff;
  }
  await runStatementsInTransaction((tx) => stageStatements(tx, bundle, versionId, diff.version, schemaVersion, bundleHash));
  return diff;
}

function groupEntries(rows: Array<typeof careerCatalogEntries.$inferSelect>) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const current = grouped.get(row.entityType) ?? [];
    current.push(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload as Record<string, unknown>);
    grouped.set(row.entityType, current);
  }
  return grouped;
}

function materializeStatements(
  tx: typeof db,
  versionId: string,
  version: string,
  grouped: Map<string, Record<string, unknown>[]>,
  scoringSafe: boolean,
) {
  const colleges = grouped.get('colleges') ?? [];
  const majors = grouped.get('majors') ?? [];
  const occupationInputs = grouped.get('occupations') ?? [];
  const aliases = grouped.get('occupation_aliases') ?? [];
  const edges = grouped.get('major_occupation_edges') ?? [];
  const requirements = grouped.get('occupation_requirements') ?? [];
  const relations = grouped.get('occupation_relations') ?? [];
  const sources = grouped.get('sources') ?? [];
  const legacyMappings = grouped.get('legacy_occupation_map') ?? [];
  const sourceById = new Map(sources.map((source) => [String(source.id), source]));
  const statements: any[] = [
    tx.update(careerCatalogVersions).set({ status: 'archived' }).where(eq(careerCatalogVersions.status, 'active')),
    tx.update(careerCatalogVersions).set({ status: 'active', activatedAt: new Date() }).where(eq(careerCatalogVersions.id, versionId)),
    tx.update(occupations).set({ active: false }),
    tx.update(careerColleges).set({ active: false }),
    tx.update(careerMajors).set({ active: false }),
    tx.update(occupationAliases).set({ active: false }),
    tx.update(majorOccupationEdges).set({ active: false }),
    tx.delete(occupationRelations),
    tx.delete(careerColleges).where(eq(careerColleges.catalogVersion, version)),
    tx.delete(careerMajors).where(eq(careerMajors.catalogVersion, version)),
    tx.delete(occupationAliases).where(eq(occupationAliases.catalogVersion, version)),
    tx.delete(majorOccupationEdges).where(eq(majorOccupationEdges.catalogVersion, version)),
    tx.delete(careerSourceSnapshots).where(eq(careerSourceSnapshots.catalogVersion, version)),
  ];

  for (const item of occupationInputs) {
    const code = String(item.code);
    statements.push(tx.insert(occupations).values({
      code,
      name: String(item.name ?? code),
      category: String(item.category ?? ''),
      canonicalType: item.canonical_type ?? 'national_occupation',
      jobFamily: String(item.job_family ?? item.category ?? ''),
      industry: String(item.industry ?? ''),
      cities: item.cities ?? [],
      educationLevels: item.education_levels ?? [],
      summary: String(item.summary ?? ''),
      description: String(item.description ?? ''),
      entryLevel: String(item.entry_level ?? ''),
      catalogVersion: version,
      reviewStatus: String(item.review_status ?? 'pending'),
      scoringEligible: scoringSafe && item.review_status === 'approved'
        && item.canonical_type !== 'unresolved_placeholder' && item.scoring_eligible === true,
      active: true,
    } as never).onConflictDoUpdate({ target: occupations.code, set: {
      name: String(item.name ?? code), category: String(item.category ?? ''),
      canonicalType: item.canonical_type ?? 'national_occupation', jobFamily: String(item.job_family ?? item.category ?? ''),
      industry: String(item.industry ?? ''), cities: item.cities ?? [], educationLevels: item.education_levels ?? [],
      summary: String(item.summary ?? ''), description: String(item.description ?? ''), entryLevel: String(item.entry_level ?? ''),
      catalogVersion: version, reviewStatus: String(item.review_status ?? 'pending'),
      scoringEligible: scoringSafe && item.review_status === 'approved'
        && item.canonical_type !== 'unresolved_placeholder' && item.scoring_eligible === true,
      active: true, updatedAt: new Date(),
    }}));
    statements.push(tx.delete(occupationRequirements).where(eq(occupationRequirements.occupationCode, code)));
    statements.push(tx.delete(careerKnowledgeDocuments).where(eq(careerKnowledgeDocuments.occupationCode, code)));
    const sourceIds = Array.isArray(item.source_ids) ? item.source_ids.map(String) : [];
    for (const sourceId of sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) continue;
      statements.push(tx.insert(careerKnowledgeDocuments).values({
        id: `catalog:${version}:${code}:${sourceId}`,
        occupationCode: code,
        title: String(source.title ?? item.name ?? code),
        content: `${String(item.description ?? '')}\n${String(item.summary ?? '')}`,
        sourceLabel: String(source.publisher ?? source.source_type ?? '公开来源'),
        sourceUrl: String(source.url ?? ''),
        publishedAt: parseDate(source.published_at as string | null),
        verifiedAt: parseDate(source.fetched_at as string | null) ?? new Date(),
        metadata: { sourceId, catalogVersion: version },
        catalogVersion: version,
        contentHash: String(source.content_sha256 ?? ''),
      } as never).onConflictDoUpdate({ target: careerKnowledgeDocuments.id, set: {
        title: String(source.title ?? item.name ?? code), content: `${String(item.description ?? '')}\n${String(item.summary ?? '')}`,
        sourceLabel: String(source.publisher ?? source.source_type ?? '公开来源'), sourceUrl: String(source.url ?? ''),
        publishedAt: parseDate(source.published_at as string | null), verifiedAt: parseDate(source.fetched_at as string | null) ?? new Date(),
        metadata: { sourceId, catalogVersion: version }, catalogVersion: version, contentHash: String(source.content_sha256 ?? ''),
      }}));
    }
  }

  colleges.forEach((item) => statements.push(tx.insert(careerColleges).values({
    id: `${version}:${String(item.id)}`, catalogVersion: version, code: String(item.id), name: String(item.name),
    sourceIds: item.source_ids ?? [], reviewStatus: String(item.review_status ?? 'pending'), active: true,
  } as never)));
  majors.forEach((item) => statements.push(tx.insert(careerMajors).values({
    id: `${version}:${String(item.id)}`, catalogVersion: version, code: String(item.id), collegeCode: String(item.college_id),
    name: String(item.name), degreeLevel: String(item.degree_level ?? ''), currentlyRecruiting: item.is_currently_recruiting !== false,
    admissionYear: typeof item.admission_year === 'number' ? item.admission_year : null, sourceIds: item.source_ids ?? [],
    sourceExcerpt: String(item.source_excerpt ?? ''), employmentText: String(item.employment_text ?? ''),
    reviewStatus: String(item.review_status ?? 'pending'), active: true,
  } as never)));
  aliases.forEach((item) => statements.push(tx.insert(occupationAliases).values({
    id: `${version}:${String(item.id)}`, catalogVersion: version, occupationCode: String(item.occupation_code),
    alias: String(item.alias), sourceIds: item.source_ids ?? [], reviewStatus: String(item.review_status ?? 'pending'), active: true,
  } as never)));
  edges.forEach((item) => statements.push(tx.insert(majorOccupationEdges).values({
    id: `${version}:${String(item.id)}`, catalogVersion: version, majorCode: String(item.major_id),
    occupationCode: item.occupation_code ? String(item.occupation_code) : null, proposedTitle: item.proposed_title ? String(item.proposed_title) : null,
    relationType: item.relation_type, sourceIds: item.source_ids ?? [], evidenceExcerpt: String(item.evidence_excerpt ?? ''),
    reviewRequired: item.review_required === true, reviewReason: String(item.review_reason ?? ''), active: true,
  } as never)));
  requirements.filter((item) => typeof item.target_score === 'number' && typeof item.weight === 'number').forEach((item) => {
    statements.push(tx.insert(occupationRequirements).values({
      id: `${version}:${String(item.id)}`, occupationCode: String(item.occupation_code), abilityCode: String(item.ability_code),
      abilityName: String(item.ability_name), dimension: item.dimension, targetScore: item.target_score, weight: item.weight,
      required: item.required !== false, description: String(item.description ?? ''), educationLevel: String(item.education_level ?? ''),
      experienceLevel: String(item.experience_level ?? ''), region: String(item.region ?? ''), sourceIds: item.source_ids ?? [],
      reviewStatus: String(item.review_status ?? 'pending'), catalogVersion: version,
    } as never).onConflictDoUpdate({ target: [occupationRequirements.occupationCode, occupationRequirements.abilityCode], set: {
      abilityName: String(item.ability_name), dimension: item.dimension, targetScore: item.target_score, weight: item.weight,
      required: item.required !== false, description: String(item.description ?? ''), educationLevel: String(item.education_level ?? ''),
      experienceLevel: String(item.experience_level ?? ''), region: String(item.region ?? ''), sourceIds: item.source_ids ?? [],
      reviewStatus: String(item.review_status ?? 'pending'), catalogVersion: version,
    }}));
  });
  relations.forEach((item) => statements.push(tx.insert(occupationRelations).values({
    id: `${version}:${String(item.id)}`,
    fromCode: String(item.from_code),
    toCode: String(item.to_code),
    relationType: item.relation_type,
    description: String(item.description ?? ''),
  } as never)));
  sources.forEach((item) => statements.push(tx.insert(careerSourceSnapshots).values({
    id: `${version}:${String(item.id)}`, catalogVersion: version, sourceId: String(item.id), url: String(item.url), title: String(item.title),
    publisher: String(item.publisher ?? ''), sourceType: String(item.source_type ?? ''),
    publishedAt: parseDate(item.published_at as string | null), fetchedAt: parseDate(item.fetched_at as string | null),
    contentHash: String(item.content_sha256), httpStatus: typeof item.http_status === 'number' ? item.http_status : null,
    robotsStatus: String(item.robots_status ?? 'unknown'), licenseNotes: String(item.license_notes ?? ''),
  } as never)));
  legacyMappings
    .filter((item) => item.review_required !== true && typeof item.old_code === 'string' && typeof item.new_code === 'string')
    .forEach((item) => {
      const oldCode = String(item.old_code);
      const newCode = String(item.new_code);
      statements.push(tx.update(careerGoals).set({ occupationCode: newCode, updatedAt: new Date() }).where(eq(careerGoals.occupationCode, oldCode)));
      statements.push(tx.update(careerTasks).set({ occupationCode: newCode, updatedAt: new Date() }).where(eq(careerTasks.occupationCode, oldCode)));
      // Historical match snapshots intentionally keep their original code and catalog version.
    });
  return statements;
}

export async function applyCareerCatalog(version: string): Promise<void> {
  await dbReady;
  const versionRows = await db.select().from(careerCatalogVersions).where(eq(careerCatalogVersions.version, version)).limit(1);
  const versionRow = versionRows[0];
  if (!versionRow) throw new Error(`Catalog version is not staged: ${version}`);
  const entries = await db.select().from(careerCatalogEntries).where(eq(careerCatalogEntries.catalogVersionId, versionRow.id));
  const grouped = groupEntries(entries);
  const metadata = typeof versionRow.metadata === 'string'
    ? JSON.parse(versionRow.metadata) as Record<string, unknown>
    : versionRow.metadata as Record<string, unknown>;
  const scoringSafe = metadata?.scoring_safe === true;
  const publicationStatus = metadata?.publication_status;
  if (!['candidate', 'approved'].includes(String(publicationStatus))) {
    throw new Error(`Catalog ${version} has an invalid publication_status.`);
  }
  if (scoringSafe && publicationStatus !== 'approved') {
    throw new Error(`Catalog ${version} cannot enable scoring before approval.`);
  }
  await runStatementsInTransaction((tx) => materializeStatements(tx, versionRow.id, version, grouped, scoringSafe));
}

export async function rollbackCareerCatalog(version: string): Promise<void> {
  // Rollback re-materializes an immutable staged snapshot and atomically moves the active pointer.
  await applyCareerCatalog(version);
}
