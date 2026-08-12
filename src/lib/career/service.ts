import 'server-only';

import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerGuidanceNotes,
  careerMatches,
  careerProfiles,
  careerProfileSnapshots,
  careerTasks,
  occupationRequirements,
  occupations,
  users,
} from '@/lib/db/schema';
import type {
  AbilityChange,
  AbilityDimensionCode,
  CareerAbility,
  CareerEvidence,
  CareerEvidenceSubmission,
  CareerGoal,
  CareerGoalInput,
  CareerMatchResult,
  CareerOverview,
  CareerPath,
  CareerPathStage,
  CareerProfile,
  CareerTask,
  CareerTaskInput,
  CareerTaskStatus,
  GuidanceNote,
  OccupationDetail,
  OccupationListFilters,
  OccupationPage,
  OccupationSummary,
  SubmittedCareerEvidence,
} from '@/types/career';
import { ABILITY_CATALOG, DIMENSION_NAMES } from './catalog';
import { careerKnowledgeProvider } from './knowledge-provider';
import { clampScore, parseJson, toIso, toNullableIso } from './serialization';

export class CareerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CareerNotFoundError';
  }
}

export class CareerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CareerValidationError';
  }
}

export class CareerGoalRequiredError extends Error {
  constructor() {
    super('A primary career goal or explicit occupationCode is required.');
    this.name = 'CareerGoalRequiredError';
  }
}

const DIMENSION_ORDER: AbilityDimensionCode[] = [
  'domain_knowledge',
  'professional_skills',
  'project_practice',
  'general_competencies',
  'job_readiness',
  'growth_potential',
];

async function ensureProfileRow(userId: string) {
  await dbReady;
  const existing = await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId)).limit(1);
  if (existing[0]) return existing[0];

  await db.insert(careerProfiles).values({ userId } as never).onConflictDoNothing();
  const created = await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId)).limit(1);
  if (!created[0]) throw new CareerNotFoundError('Career profile could not be created for this user.');
  return created[0];
}

function mapEvidence(row: typeof careerEvidence.$inferSelect): CareerEvidence {
  return {
    id: row.id,
    abilityCode: row.abilityCode,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: row.title,
    excerpt: row.excerpt,
    sourceUrl: row.sourceUrl,
    status: row.status,
    assessedScore: row.assessedScore,
    reviewReason: row.reviewReason,
    reviewedAt: toNullableIso(row.reviewedAt),
    occurredAt: toNullableIso(row.occurredAt),
    createdAt: toIso(row.createdAt),
  };
}

function mapTask(row: typeof careerTasks.$inferSelect): CareerTask {
  return {
    id: row.id,
    userId: row.userId,
    goalId: row.goalId,
    occupationCode: row.occupationCode,
    abilityCode: row.abilityCode,
    title: row.title,
    description: row.description,
    reason: row.reason,
    completionCriteria: row.completionCriteria,
    category: row.category,
    status: row.status,
    dueAt: toNullableIso(row.dueAt),
    completedAt: toNullableIso(row.completedAt),
    assignedBy: row.assignedBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function mapGoal(row: typeof careerGoals.$inferSelect): Promise<CareerGoal> {
  const occupation = await getOccupationByCode(row.occupationCode);
  return {
    id: row.id,
    userId: row.userId,
    occupationCode: row.occupationCode,
    occupationName: occupation?.name ?? row.occupationCode,
    isPrimary: row.isPrimary,
    status: row.status,
    targetDate: toNullableIso(row.targetDate),
    rationale: row.rationale,
    preferences: parseJson<CareerGoal['preferences']>(row.preferences, {}),
    teacherConfirmationStatus: row.teacherConfirmationStatus,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function getCareerProfile(userId: string): Promise<CareerProfile> {
  const profileRow = await ensureProfileRow(userId);
  const [rawAbilityRows, rawEvidenceRows] = await Promise.all([
    db.select().from(careerAbilities).where(eq(careerAbilities.userId, userId)).orderBy(asc(careerAbilities.code)),
    db.select().from(careerEvidence).where(eq(careerEvidence.userId, userId)).orderBy(desc(careerEvidence.createdAt)),
  ]);
  const abilityRows = rawAbilityRows as Array<typeof careerAbilities.$inferSelect>;
  const evidenceRows = rawEvidenceRows as Array<typeof careerEvidence.$inferSelect>;

  const evidenceByAbility = new Map<string, CareerEvidence[]>();
  for (const row of evidenceRows) {
    const evidence = mapEvidence(row);
    const current = evidenceByAbility.get(row.abilityCode) ?? [];
    current.push(evidence);
    evidenceByAbility.set(row.abilityCode, current);
  }

  const rowByCode = new Map(abilityRows.map((row) => [row.code, row]));
  const definitions = [...ABILITY_CATALOG];
  for (const row of abilityRows) {
    if (!definitions.some((definition) => definition.code === row.code)) {
      definitions.push({ code: row.code, name: row.name, dimension: row.dimension });
    }
  }

  const abilities: CareerAbility[] = definitions.map((definition) => {
    const row = rowByCode.get(definition.code);
    const evidence = evidenceByAbility.get(definition.code) ?? [];
    const verifiedCount = evidence.filter((item) => item.status === 'verified').length;
    const score = row?.score ?? null;
    return {
      code: definition.code,
      name: row?.name ?? definition.name,
      dimension: row?.dimension ?? definition.dimension,
      score,
      status: score == null ? 'unknown' : 'known',
      confidence: row?.confidence ?? null,
      evidenceCount: Math.max(row?.evidenceCount ?? 0, verifiedCount),
      evidence,
      updatedAt: row ? toIso(row.updatedAt) : toIso(profileRow.updatedAt),
    };
  });

  const knownAbilities = abilities.filter((ability) => ability.score != null);
  const abilitiesWithVerifiedEvidence = knownAbilities.filter((ability) => ability.evidence.some((item) => item.status === 'verified'));
  const identityCompleteness = (profileRow.headline.trim() ? 15 : 0) + (profileRow.summary.trim() ? 15 : 0);
  const completeness = clampScore(identityCompleteness + (knownAbilities.length / abilities.length) * 70);
  const evidenceCoverage = knownAbilities.length
    ? clampScore((abilitiesWithVerifiedEvidence.length / knownAbilities.length) * 100)
    : 0;

  const dimensions = DIMENSION_ORDER.map((dimensionCode) => {
    const dimensionAbilities = abilities.filter((ability) => ability.dimension === dimensionCode);
    const knownScores = dimensionAbilities.flatMap((ability) => ability.score == null ? [] : [ability.score]);
    return {
      code: dimensionCode,
      name: DIMENSION_NAMES[dimensionCode],
      score: knownScores.length ? clampScore(knownScores.reduce((sum, score) => sum + score, 0) / knownScores.length) : null,
      status: knownScores.length ? 'known' as const : 'unknown' as const,
      abilities: dimensionAbilities,
    };
  });

  return {
    userId,
    headline: profileRow.headline,
    summary: profileRow.summary,
    stage: profileRow.stage,
    completeness,
    evidenceCoverage,
    dimensions,
    updatedAt: toIso(profileRow.updatedAt),
  };
}

export async function listOccupations(query?: string): Promise<OccupationSummary[]> {
  return (await careerKnowledgeProvider.listOccupations({ query, limit: 100, offset: 0 })).items;
}

export async function listOccupationPage(filters: OccupationListFilters = {}): Promise<OccupationPage> {
  return careerKnowledgeProvider.listOccupations(filters);
}

export async function getOccupationByCode(code: string): Promise<OccupationDetail | null> {
  return careerKnowledgeProvider.getOccupationByCode(code);
}

async function isActiveScorableOccupation(code: string): Promise<boolean> {
  const rows = await db.select({ code: occupations.code }).from(occupations)
    .innerJoin(occupationRequirements, eq(occupationRequirements.occupationCode, occupations.code))
    .where(and(eq(occupations.code, code), eq(occupations.active, true), eq(occupations.scoringEligible, true)))
    .limit(1);
  return Boolean(rows[0]);
}

export async function listCareerGoals(userId: string): Promise<CareerGoal[]> {
  await dbReady;
  const rows = await db.select().from(careerGoals)
    .where(and(eq(careerGoals.userId, userId), ne(careerGoals.status, 'archived')))
    .orderBy(desc(careerGoals.isPrimary), desc(careerGoals.updatedAt));
  return Promise.all(rows.map(mapGoal));
}

export async function listCareerTasks(userId: string): Promise<CareerTask[]> {
  await dbReady;
  const rows = await db.select().from(careerTasks)
    .where(eq(careerTasks.userId, userId))
    .orderBy(asc(careerTasks.dueAt), desc(careerTasks.updatedAt));
  return rows.map(mapTask);
}

/** Submit unscored evidence for a requirement on one of the student's active goals. */
export async function submitCareerEvidence(
  userId: string,
  input: CareerEvidenceSubmission,
): Promise<SubmittedCareerEvidence> {
  await ensureProfileRow(userId);
  const goalRows = await db.select({ id: careerGoals.id }).from(careerGoals).where(and(
    eq(careerGoals.userId, userId),
    eq(careerGoals.occupationCode, input.occupationCode),
    ne(careerGoals.status, 'archived'),
  )).limit(1);
  if (!goalRows[0]) throw new CareerValidationError('Evidence can only be submitted for an active career goal.');

  const requirementRows = await db.select({
    abilityName: occupationRequirements.abilityName,
    dimension: occupationRequirements.dimension,
  }).from(occupationRequirements)
    .innerJoin(occupations, and(
      eq(occupations.code, occupationRequirements.occupationCode),
      eq(occupations.active, true),
    ))
    .where(and(
      eq(occupationRequirements.occupationCode, input.occupationCode),
      eq(occupationRequirements.abilityCode, input.abilityCode),
    ))
    .limit(1);
  const requirement = requirementRows[0];
  if (!requirement) throw new CareerValidationError('Ability is not a requirement of the active goal occupation.');

  const id = crypto.randomUUID();
  await db.insert(careerAbilities).values({
    userId,
    code: input.abilityCode,
    name: requirement.abilityName,
    dimension: requirement.dimension,
    score: null,
    confidence: null,
  } as never).onConflictDoUpdate({
    target: [careerAbilities.userId, careerAbilities.code],
    set: { name: requirement.abilityName, dimension: requirement.dimension, updatedAt: new Date() },
  });
  await db.insert(careerEvidence).values({
    id,
    userId,
    abilityCode: input.abilityCode,
    sourceType: 'manual',
    sourceId: `manual:${input.occupationCode}:${id}`,
    title: input.title.trim(),
    excerpt: input.description.trim(),
    sourceUrl: input.sourceUrl?.trim() || null,
    status: 'pending',
    assessedScore: null,
  });
  const row = await db.select().from(careerEvidence).where(and(
    eq(careerEvidence.id, id),
    eq(careerEvidence.userId, userId),
  )).limit(1);
  if (!row[0]) throw new CareerNotFoundError('Evidence could not be created.');
  return { ...mapEvidence(row[0]), occupationCode: input.occupationCode };
}

function taskAction(abilityName: string, state: 'met' | 'gap' | 'unknown', gap: number | null): string {
  if (state === 'met') return `继续通过项目或面试材料巩固“${abilityName}”的证据。`;
  if (state === 'unknown') return `先上传课程、项目或实践材料，确认“${abilityName}”的当前水平。`;
  return `围绕“${abilityName}”制定练习任务，优先补齐约 ${gap ?? 0} 分差距。`;
}

export async function getCareerMatch(userId: string, occupationCode?: string): Promise<CareerMatchResult> {
  const goals = occupationCode ? [] : await listCareerGoals(userId);
  const code = occupationCode ?? goals.find((goal) => goal.isPrimary)?.occupationCode;
  if (!code) throw new CareerGoalRequiredError();

  const [occupation, profile] = await Promise.all([
    getOccupationByCode(code),
    getCareerProfile(userId),
  ]);
  if (!occupation) throw new CareerNotFoundError('Occupation not found.');

  const abilityByCode = new Map(profile.dimensions.flatMap((dimension) => dimension.abilities).map((ability) => [ability.code, ability]));
  const totalWeight = occupation.requirements.reduce((sum, requirement) => sum + requirement.weight, 0);
  let knownWeight = 0;
  let weightedAchievement = 0;
  let evidencedWeight = 0;

  const dimensionBreakdown = occupation.requirements.map((requirement) => {
    const student = abilityByCode.get(requirement.abilityCode);
    const studentScore = student?.score ?? null;
    const state = studentScore == null
      ? 'unknown' as const
      : studentScore >= requirement.targetScore
        ? 'met' as const
        : 'gap' as const;
    const gap = studentScore == null ? null : Math.max(0, requirement.targetScore - studentScore);
    if (studentScore != null) {
      knownWeight += requirement.weight;
      weightedAchievement += Math.min(studentScore / requirement.targetScore, 1) * requirement.weight;
    }
    if (student?.evidence.some((item) => item.status === 'verified' && item.assessedScore != null)) {
      evidencedWeight += requirement.weight;
    }
    return {
      dimension: requirement.dimension,
      abilityCode: requirement.abilityCode,
      abilityName: requirement.abilityName,
      requirement: {
        targetScore: requirement.targetScore,
        weight: requirement.weight,
        required: requirement.required,
        description: requirement.description,
      },
      studentScore,
      studentEvidence: student?.evidence ?? [],
      state,
      gap,
      action: taskAction(requirement.abilityName, state, gap),
    };
  });

  const rawScore = knownWeight ? clampScore((weightedAchievement / knownWeight) * 100) : null;
  const knownCoverage = totalWeight ? clampScore((knownWeight / totalWeight) * 100) : 0;
  const evidenceCoverage = totalWeight ? clampScore((evidencedWeight / totalWeight) * 100) : 0;
  const scoringStatus = occupation.scoringEligible === false || occupation.requirements.length === 0
    ? 'not_eligible' as const
    : knownCoverage >= 50 && evidenceCoverage >= 40
      ? 'ready' as const
      : 'insufficient_evidence' as const;
  const score = scoringStatus === 'ready' ? rawScore : null;
  const confidence = scoringStatus === 'ready'
    ? clampScore((knownCoverage * 0.4) + (evidenceCoverage * 0.6))
    : null;
  const strengths = dimensionBreakdown
    .filter((item) => item.state === 'met' && item.studentEvidence.some((evidence) => evidence.status === 'verified' && evidence.assessedScore != null))
    .sort((a, b) => b.requirement.weight - a.requirement.weight)
    .slice(0, 3);
  const priorityGaps = dimensionBreakdown
    .filter((item) => item.state !== 'met')
    .sort((a, b) => Number(b.requirement.required) - Number(a.requirement.required)
      || b.requirement.weight - a.requirement.weight
      || (b.gap ?? -1) - (a.gap ?? -1))
    .slice(0, 3);
  const previousRows = await db.select({ score: careerMatches.score })
    .from(careerMatches)
    .where(and(eq(careerMatches.userId, userId), eq(careerMatches.occupationCode, code)))
    .orderBy(desc(careerMatches.createdAt))
    .limit(1);
  const previousScore = previousRows[0]?.score ?? null;
  const changeSummary = previousRows[0]
    ? {
        previousScore,
        currentScore: score,
        delta: previousScore == null || score == null ? null : score - previousScore,
        reason: '根据当前已确认能力证据重新计算。',
      }
    : null;
  const catalogVersion = occupation.catalogVersion ?? await careerKnowledgeProvider.getActiveCatalogVersion();

  return {
    occupation: {
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      matchScore: score,
      evidenceCoverage,
    },
    score,
    evidenceCoverage,
    knownWeight,
    totalWeight,
    dimensionBreakdown,
    citations: occupation.citations,
    algorithmVersion: 'career-match-v1',
    catalogVersion,
    scoringStatus,
    confidence,
    knownCoverage,
    strengths,
    priorityGaps,
    changeSummary,
    generatedAt: new Date().toISOString(),
  };
}

/** Persist a match snapshot only for an explicit recalculation action. */
export async function calculateAndPersistCareerMatch(userId: string, occupationCode?: string): Promise<CareerMatchResult> {
  const result = await getCareerMatch(userId, occupationCode);
  const goals = await listCareerGoals(userId);
  const goalId = goals.find((goal) => goal.occupationCode === result.occupation.code)?.id ?? null;
  await db.insert(careerMatches).values({
    userId,
    goalId,
    occupationCode: result.occupation.code,
    score: result.score,
    evidenceCoverage: result.evidenceCoverage,
    knownWeight: result.knownWeight,
    totalWeight: result.totalWeight,
    breakdown: result.dimensionBreakdown,
    citations: result.citations,
    algorithmVersion: result.algorithmVersion,
    catalogVersion: result.catalogVersion,
    confidence: result.confidence,
    knownCoverage: result.knownCoverage,
  } as never);
  return result;
}

async function getLatestAbilityChanges(userId: string): Promise<AbilityChange[]> {
  const snapshots = await db.select().from(careerProfileSnapshots)
    .where(eq(careerProfileSnapshots.userId, userId))
    .orderBy(desc(careerProfileSnapshots.version))
    .limit(2);
  if (snapshots.length < 2) return [];

  type SnapshotAbility = { code: string; name: string; dimension: AbilityDimensionCode; score: number | null };
  const current = parseJson<SnapshotAbility[]>(snapshots[0].abilities, []);
  const previous = new Map(parseJson<SnapshotAbility[]>(snapshots[1].abilities, []).map((item) => [item.code, item]));
  return current.flatMap((item) => {
    const before = previous.get(item.code);
    if (!before || before.score === item.score) return [];
    return [{
      abilityCode: item.code,
      abilityName: item.name,
      dimension: item.dimension,
      fromScore: before.score,
      toScore: item.score,
      delta: before.score == null || item.score == null ? null : item.score - before.score,
      reason: snapshots[0].trigger,
      changedAt: toIso(snapshots[0].createdAt),
    }];
  });
}

async function getLatestGuidance(userId: string): Promise<GuidanceNote[]> {
  const rows = await db.select({
    id: careerGuidanceNotes.id,
    teacherId: careerGuidanceNotes.teacherId,
    teacherName: users.name,
    visibility: careerGuidanceNotes.visibility,
    content: careerGuidanceNotes.content,
    createdAt: careerGuidanceNotes.createdAt,
  }).from(careerGuidanceNotes)
    .innerJoin(users, eq(users.id, careerGuidanceNotes.teacherId))
    .where(and(eq(careerGuidanceNotes.userId, userId), eq(careerGuidanceNotes.visibility, 'student')))
    .orderBy(desc(careerGuidanceNotes.createdAt))
    .limit(5) as Array<{
      id: string;
      teacherId: string;
      teacherName: string | null;
      visibility: 'student' | 'teacher_private' | 'management';
      content: string;
      createdAt: Date;
    }>;

  return rows.map((row) => ({
    id: row.id,
    teacherId: row.teacherId,
    teacherName: row.teacherName ?? '指导教师',
    visibility: row.visibility,
    content: row.content,
    createdAt: toIso(row.createdAt),
  }));
}

export async function getCareerOverview(userId: string): Promise<CareerOverview> {
  const [profile, goals, tasks, abilityChanges, latestGuidance] = await Promise.all([
    getCareerProfile(userId),
    listCareerGoals(userId),
    listCareerTasks(userId),
    getLatestAbilityChanges(userId),
    getLatestGuidance(userId),
  ]);
  const primaryGoal = goals.find((goal) => goal.isPrimary) ?? goals[0] ?? null;
  const match = primaryGoal ? await getCareerMatch(userId, primaryGoal.occupationCode) : null;
  const knownDimensionScores = profile.dimensions.flatMap((dimension) => dimension.score == null ? [] : [dimension.score]);
  const readiness = knownDimensionScores.length
    ? clampScore(knownDimensionScores.reduce((sum, score) => sum + score, 0) / knownDimensionScores.length)
    : null;

  return {
    profile,
    primaryGoal,
    indicators: {
      readiness,
      match: match?.score ?? null,
      profileCompleteness: profile.completeness,
      evidenceCoverage: match?.evidenceCoverage ?? profile.evidenceCoverage,
    },
    abilityChanges,
    nextTasks: tasks.filter((task) => task.status === 'todo' || task.status === 'in_progress').slice(0, 6),
    latestGuidance,
    generatedAt: new Date().toISOString(),
  };
}

function stageStatus(tasks: CareerTask[]): CareerPathStage['status'] {
  if (tasks.length && tasks.every((task) => task.status === 'completed')) return 'completed';
  if (tasks.some((task) => task.status === 'in_progress')) return 'current';
  return 'locked';
}

export async function getCareerPath(userId: string): Promise<CareerPath> {
  const [goals, tasks] = await Promise.all([listCareerGoals(userId), listCareerTasks(userId)]);
  const goal = goals.find((item) => item.isPrimary) ?? goals[0] ?? null;
  if (!goal) return { goal: null, stages: [], currentStageIndex: 0, updatedAt: new Date().toISOString() };

  const goalTasks = tasks.filter((task) => task.goalId === goal.id);
  const stageDefinitions = [
    { id: 'explore', title: '确认方向', description: '理解岗位、确认目标并补齐材料证据。', categories: ['explore'] },
    { id: 'prepare', title: '能力与作品', description: '补齐关键能力，形成可验证的项目和作品。', categories: ['learn', 'practice', 'portfolio'] },
    { id: 'apply', title: '求职行动', description: '完成材料投递、模拟面试和阶段复盘。', categories: ['application'] },
  ] as const;
  const rawStages = stageDefinitions.map((definition, index) => {
    const stageTasks = goalTasks.filter((task) => definition.categories.some((category) => category === task.category));
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      order: index,
      status: stageStatus(stageTasks),
      targetDate: index === stageDefinitions.length - 1 ? goal.targetDate : null,
      tasks: stageTasks,
    };
  });
  // Prefer the stage that already contains active work. Empty earlier stages
  // must not lock a later stage that has an in-progress teacher/system task.
  let currentStageIndex = rawStages.findIndex((stage) => stage.status === 'current');
  if (currentStageIndex < 0) {
    currentStageIndex = rawStages.findIndex(
      (stage) => stage.tasks.length > 0 && stage.status !== 'completed',
    );
  }
  if (currentStageIndex < 0) {
    currentStageIndex = rawStages.findIndex((stage) => stage.status !== 'completed');
  }
  if (currentStageIndex < 0) currentStageIndex = rawStages.length - 1;
  const stages: CareerPathStage[] = rawStages.map((stage, index) => ({
    ...stage,
    status: stage.status === 'completed' ? 'completed' : index === currentStageIndex ? 'current' : 'locked',
  }));

  return {
    goal,
    stages,
    currentStageIndex,
    updatedAt: [goal.updatedAt, ...goalTasks.map((task) => task.updatedAt)].sort().at(-1) ?? goal.updatedAt,
  };
}

function parseOptionalDate(value: string | null | undefined, fieldName: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new CareerValidationError(`${fieldName} must be a valid ISO date.`);
  return parsed;
}

async function createDefaultGoalTasks(userId: string, goal: CareerGoal): Promise<void> {
  const existing = await db.select({ id: careerTasks.id }).from(careerTasks).where(eq(careerTasks.goalId, goal.id)).limit(1);
  if (existing[0]) return;
  const defaults: CareerTaskInput[] = [
    { goalId: goal.id, occupationCode: goal.occupationCode, abilityCode: 'career_exploration', title: `阅读“${goal.occupationName}”岗位画像`, description: '查看能力要求与引用来源，记录仍不确定的问题。', reason: '先明确岗位边界，避免在目标不清晰时盲目补技能。', completionCriteria: '至少记录 3 项岗位要求和 2 个待确认问题。', category: 'explore' },
    { goalId: goal.id, occupationCode: goal.occupationCode, abilityCode: 'continuous_learning', title: '补充一项能力证据', description: '提交课程、项目、证书或实践材料，避免把未知能力误判为零分。', reason: '提升画像可信度与证据覆盖率。', completionCriteria: '提交一项可复核材料并关联到具体能力。', category: 'learn' },
    { goalId: goal.id, occupationCode: goal.occupationCode, abilityCode: 'project_delivery', title: '完成一个岗位相关作品', description: '产出可运行、可复核且能说明个人贡献的成果。', reason: '用真实成果证明岗位所需能力。', completionCriteria: '提交项目链接、个人贡献说明与结果复盘。', category: 'portfolio' },
    { goalId: goal.id, occupationCode: goal.occupationCode, abilityCode: 'interview', title: '完成一次目标岗位模拟面试', description: '根据评估报告选择一项能力继续改进。', reason: '把知识与项目经历转化为可表达的面试证据。', completionCriteria: '完成一轮面试并保存评估报告。', category: 'practice' },
    { goalId: goal.id, occupationCode: goal.occupationCode, abilityCode: 'career_exploration', title: '形成第一版求职行动清单', description: '整理目标企业、岗位渠道、材料与投递节奏。', reason: '将目标和准备转化为可执行的求职行动。', completionCriteria: '形成至少 5 个目标岗位及对应投递计划。', category: 'application', dueAt: goal.targetDate },
  ];
  for (const task of defaults) await createCareerTask(userId, task);
}

export async function upsertCareerGoal(userId: string, input: CareerGoalInput): Promise<CareerGoal> {
  await ensureProfileRow(userId);
  const occupation = await getOccupationByCode(input.occupationCode);
  if (!occupation || !(await isActiveScorableOccupation(input.occupationCode))) {
    throw new CareerValidationError('Career goals require an active, scoring-eligible occupation with requirements.');
  }
  const isPrimary = input.isPrimary ?? true;
  const now = new Date();
  if (isPrimary) {
    await db.update(careerGoals).set({ isPrimary: false, updatedAt: now })
      .where(and(eq(careerGoals.userId, userId), eq(careerGoals.isPrimary, true)));
  }

  const existing = await db.select().from(careerGoals)
    .where(and(eq(careerGoals.userId, userId), eq(careerGoals.occupationCode, input.occupationCode), ne(careerGoals.status, 'archived')))
    .limit(1);
  let row: typeof careerGoals.$inferSelect | undefined;
  if (existing[0]) {
    await db.update(careerGoals).set({
      isPrimary,
      status: 'active',
      targetDate: parseOptionalDate(input.targetDate, 'targetDate'),
      rationale: input.rationale?.trim() ?? existing[0].rationale,
      preferences: input.preferences ?? parseJson(existing[0].preferences, {}),
      teacherConfirmationStatus: 'unreviewed',
      updatedAt: now,
    }).where(and(eq(careerGoals.id, existing[0].id), eq(careerGoals.userId, userId)));
    row = (await db.select().from(careerGoals).where(and(eq(careerGoals.id, existing[0].id), eq(careerGoals.userId, userId))).limit(1))[0];
  } else {
    const id = crypto.randomUUID();
    await db.insert(careerGoals).values({
      id,
      userId,
      occupationCode: input.occupationCode,
      isPrimary,
      status: 'active',
      targetDate: parseOptionalDate(input.targetDate, 'targetDate'),
      rationale: input.rationale?.trim() ?? '',
      preferences: input.preferences ?? {},
      teacherConfirmationStatus: 'unreviewed',
    } as never);
    row = (await db.select().from(careerGoals).where(and(eq(careerGoals.id, id), eq(careerGoals.userId, userId))).limit(1))[0];
  }
  if (!row) throw new CareerNotFoundError('Goal could not be saved.');
  await db.update(careerProfiles).set({ stage: 'targeting', updatedAt: now }).where(eq(careerProfiles.userId, userId));
  const goal = await mapGoal(row);
  await createDefaultGoalTasks(userId, goal);
  return goal;
}

export async function createCareerTask(userId: string, input: CareerTaskInput): Promise<CareerTask> {
  await dbReady;
  await ensureProfileRow(userId);
  const title = input.title.trim();
  if (!title) throw new CareerValidationError('Task title is required.');
  if (input.goalId) {
    const goal = await db.select({ id: careerGoals.id }).from(careerGoals)
      .where(and(eq(careerGoals.id, input.goalId), eq(careerGoals.userId, userId)))
      .limit(1);
    if (!goal[0]) throw new CareerNotFoundError('Goal not found.');
  }
  if (input.occupationCode && !(await isActiveScorableOccupation(input.occupationCode))) {
    const legacyGoal = await db.select({ id: careerGoals.id }).from(careerGoals).where(and(
      eq(careerGoals.userId, userId),
      eq(careerGoals.occupationCode, input.occupationCode),
      ne(careerGoals.status, 'archived'),
    )).limit(1);
    if (!legacyGoal[0]) throw new CareerValidationError('Task occupation must be active or belong to an existing legacy goal.');
  }

  const id = crypto.randomUUID();
  await db.insert(careerTasks).values({
    id,
    userId,
    goalId: input.goalId ?? null,
    occupationCode: input.occupationCode ?? null,
    abilityCode: input.abilityCode ?? null,
    title,
    description: input.description?.trim() ?? '',
    reason: input.reason?.trim() ?? '',
    completionCriteria: input.completionCriteria?.trim() ?? '',
    category: input.category ?? 'learn',
    dueAt: parseOptionalDate(input.dueAt, 'dueAt'),
    assignedBy: input.assignedBy ?? null,
  } as never);
  const row = await db.select().from(careerTasks).where(and(eq(careerTasks.id, id), eq(careerTasks.userId, userId))).limit(1);
  if (!row[0]) throw new CareerNotFoundError('Task could not be created.');
  return mapTask(row[0]);
}

export async function updateCareerTaskStatus(userId: string, taskId: string, status: CareerTaskStatus): Promise<CareerTask | null> {
  const existing = await db.select().from(careerTasks)
    .where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)))
    .limit(1);
  if (!existing[0]) return null;
  const now = new Date();
  await db.update(careerTasks).set({
    status,
    completedAt: status === 'completed' ? now : null,
    updatedAt: now,
  }).where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)));
  if (existing[0].status !== 'completed' && status === 'completed' && existing[0].abilityCode) {
    await db.insert(careerEvidence).values({
      id: `task-evidence:${existing[0].id}:${existing[0].abilityCode}`,
      userId,
      abilityCode: existing[0].abilityCode,
      sourceType: 'task',
      sourceId: existing[0].id,
      title: existing[0].title,
      excerpt: existing[0].completionCriteria || existing[0].description,
      status: 'pending',
      occurredAt: now,
    } as never).onConflictDoNothing();
  }
  const updated = await db.select().from(careerTasks)
    .where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)))
    .limit(1);
  return updated[0] ? mapTask(updated[0]) : null;
}
