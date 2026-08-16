import 'server-only';

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
import { ABILITY_CATALOG } from './catalog';
import { ABILITY_DIMENSION_ORDER, CAREER_MATCHING_CONFIG, DIMENSION_NAMES } from './matching-config';
import { calculateCareerMatch } from './matching-engine';
import { careerKnowledgeProvider } from './knowledge-provider';
import { extractRequirementTerms, rankOccupationsFromJd } from './jd-matcher';
import type { CareerJdMatchResult } from '@/types/career';
import { clampScore, parseJson, toIso, toNullableIso } from './serialization';
import {
  careerRepository,
  type CareerEvidenceRow,
  type CareerGoalRow,
  type CareerTaskRow,
} from './career.repository';

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

async function ensureProfileRow(userId: string) {
  const profile = await careerRepository.ensureProfile(userId);
  if (!profile) throw new CareerNotFoundError('Career profile could not be created for this user.');
  return profile;
}

function mapEvidence(row: CareerEvidenceRow): CareerEvidence {
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

function mapTask(row: CareerTaskRow): CareerTask {
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

function mapGoal(row: CareerGoalRow, occupationName?: string | null): CareerGoal {
  return {
    id: row.id,
    userId: row.userId,
    occupationCode: row.occupationCode,
    occupationName: occupationName ?? row.occupationCode,
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
  const { abilities: abilityRows, evidence: evidenceRows } = await careerRepository.findProfileData(userId);

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

  const dimensions = ABILITY_DIMENSION_ORDER.map((dimensionCode) => {
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

export async function matchJobDescription(userId: string, jd: string): Promise<CareerJdMatchResult> {
  const description = jd.trim();
  if (description.length < 40) throw new CareerValidationError('Job description must contain at least 40 characters.');
  if (description.length > 20_000) throw new CareerValidationError('Job description is too long.');
  const occupationsPage = await listOccupationPage({ limit: 100, offset: 0 });
  const ranked = rankOccupationsFromJd(description, occupationsPage.items.filter((item) => item.scoringEligible));
  if (!ranked[0]) throw new CareerValidationError('No occupation could be inferred from this job description. Add the job title and key responsibilities.');
  const detail = await getOccupationByCode(ranked[0].occupation.code);
  if (!detail) throw new CareerNotFoundError('Inferred occupation not found.');
  const topScore = ranked[0].score;
  return {
    occupation: ranked[0].occupation,
    match: await getCareerMatch(userId, ranked[0].occupation.code),
    confidence: topScore >= 10 ? 'high' : topScore >= 5 ? 'medium' : 'low',
    matchedTerms: ranked[0].matchedTerms,
    requirementTerms: extractRequirementTerms(description, detail),
    alternatives: ranked.slice(1, 4).map((item) => item.occupation),
  };
}

export async function listCareerGoals(userId: string): Promise<CareerGoal[]> {
  const rows = await careerRepository.findGoals(userId);
  return rows.map((row) => mapGoal(row.goal, row.occupationName));
}

export async function listCareerTasks(userId: string): Promise<CareerTask[]> {
  const rows = await careerRepository.findTasks(userId);
  return rows.map(mapTask);
}

/** Submit unscored evidence for a requirement on one of the student's active goals. */
export async function submitCareerEvidence(
  userId: string,
  input: CareerEvidenceSubmission,
): Promise<SubmittedCareerEvidence> {
  await ensureProfileRow(userId);
  if (!(await careerRepository.hasActiveGoal(userId, input.occupationCode))) {
    throw new CareerValidationError('Evidence can only be submitted for an active career goal.');
  }
  const requirement = await careerRepository.findActiveRequirement(input.occupationCode, input.abilityCode);
  if (!requirement) throw new CareerValidationError('Ability is not a requirement of the active goal occupation.');

  const id = crypto.randomUUID();
  await careerRepository.upsertAbilityDefinition({
    userId,
    code: input.abilityCode,
    name: requirement.abilityName,
    dimension: requirement.dimension,
  });
  const row = await careerRepository.createManualEvidence({
    id,
    userId,
    occupationCode: input.occupationCode,
    abilityCode: input.abilityCode,
    title: input.title.trim(),
    description: input.description.trim(),
    sourceUrl: input.sourceUrl?.trim() || null,
  });
  if (!row) throw new CareerNotFoundError('Evidence could not be created.');
  return { ...mapEvidence(row), occupationCode: input.occupationCode };
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

  const calculation = calculateCareerMatch(
    occupation.requirements,
    profile.dimensions.flatMap((dimension) => dimension.abilities),
    occupation.scoringEligible !== false,
  );
  const {
    score,
    evidenceCoverage,
    knownWeight,
    totalWeight,
    dimensionBreakdown,
    scoringStatus,
    confidence,
    knownCoverage,
    strengths,
    priorityGaps,
  } = calculation;
  const previousMatch = await careerRepository.findPreviousMatchScore(userId, code);
  const previousScore = previousMatch?.score ?? null;
  const changeSummary = previousMatch
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
    algorithmVersion: CAREER_MATCHING_CONFIG.version,
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
  await careerRepository.insertMatch(userId, goalId, result);
  return result;
}

async function getLatestAbilityChanges(userId: string): Promise<AbilityChange[]> {
  const snapshots = await careerRepository.findLatestAbilitySnapshots(userId);
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
  const rows = await careerRepository.findLatestStudentGuidance(userId);

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
  if (await careerRepository.hasTasksForGoal(goal.id)) return;
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
  if (!occupation || !(await careerRepository.isActiveScorableOccupation(input.occupationCode))) {
    throw new CareerValidationError('Career goals require an active, scoring-eligible occupation with requirements.');
  }
  const now = new Date();
  const row = await careerRepository.saveGoal(
    userId,
    input,
    parseOptionalDate(input.targetDate, 'targetDate'),
    now,
  );
  if (!row) throw new CareerNotFoundError('Goal could not be saved.');
  const goal = mapGoal(row, occupation.name);
  await createDefaultGoalTasks(userId, goal);
  return goal;
}

export async function createCareerTask(userId: string, input: CareerTaskInput): Promise<CareerTask> {
  await ensureProfileRow(userId);
  const title = input.title.trim();
  if (!title) throw new CareerValidationError('Task title is required.');
  if (input.goalId) {
    if (!(await careerRepository.findGoalById(userId, input.goalId))) throw new CareerNotFoundError('Goal not found.');
  }
  if (input.occupationCode && !(await careerRepository.isActiveScorableOccupation(input.occupationCode))) {
    if (!(await careerRepository.hasLegacyGoal(userId, input.occupationCode))) {
      throw new CareerValidationError('Task occupation must be active or belong to an existing legacy goal.');
    }
  }

  const row = await careerRepository.createTask(userId, input, title, parseOptionalDate(input.dueAt, 'dueAt'));
  if (!row) throw new CareerNotFoundError('Task could not be created.');
  return mapTask(row);
}

export async function updateCareerTaskStatus(userId: string, taskId: string, status: CareerTaskStatus): Promise<CareerTask | null> {
  const updated = await careerRepository.updateTaskStatus(userId, taskId, status);
  return updated ? mapTask(updated) : null;
}
