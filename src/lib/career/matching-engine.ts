import type {
  CareerAbility,
  CareerMatchBreakdownItem,
  OccupationRequirement,
} from '@/types/career';
import { clampScore } from './serialization';
import { CAREER_MATCHING_CONFIG, type CareerMatchingConfig } from './matching-config';

function nextAction(abilityName: string, state: 'met' | 'gap' | 'unknown', gap: number | null): string {
  if (state === 'met') return `继续通过项目或面试材料巩固“${abilityName}”的证据。`;
  if (state === 'unknown') return `先上传课程、项目或实践材料，确认“${abilityName}”的当前水平。`;
  return `围绕“${abilityName}”制定练习任务，优先补齐约 ${gap ?? 0} 分差距。`;
}

export interface CareerMatchCalculation {
  score: number | null;
  rawScore: number | null;
  evidenceCoverage: number;
  knownCoverage: number;
  knownWeight: number;
  totalWeight: number;
  scoringStatus: 'ready' | 'insufficient_evidence' | 'not_eligible';
  confidence: number | null;
  dimensionBreakdown: CareerMatchBreakdownItem[];
  strengths: CareerMatchBreakdownItem[];
  priorityGaps: CareerMatchBreakdownItem[];
}

/** Pure, deterministic scoring engine. Data access and persistence stay in the service layer. */
export function calculateCareerMatch(
  requirements: OccupationRequirement[],
  abilities: CareerAbility[],
  scoringEligible: boolean,
  config: CareerMatchingConfig = CAREER_MATCHING_CONFIG,
): CareerMatchCalculation {
  const abilityByCode = new Map(abilities.map((ability) => [ability.code, ability]));
  const totalWeight = requirements.reduce((sum, requirement) => sum + requirement.weight, 0);
  let knownWeight = 0;
  let weightedAchievement = 0;
  let evidencedWeight = 0;

  const dimensionBreakdown = requirements.map((requirement): CareerMatchBreakdownItem => {
    const student = abilityByCode.get(requirement.abilityCode);
    const studentScore = student?.score ?? null;
    const state = studentScore == null
      ? 'unknown' as const
      : studentScore >= requirement.targetScore ? 'met' as const : 'gap' as const;
    const gap = studentScore == null ? null : Math.max(0, requirement.targetScore - studentScore);
    if (studentScore != null) {
      knownWeight += requirement.weight;
      weightedAchievement += Math.min(
        studentScore / requirement.targetScore,
        config.scoring.achievementCapRatio,
      ) * requirement.weight;
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
      action: nextAction(requirement.abilityName, state, gap),
    };
  });

  const rawScore = knownWeight ? clampScore((weightedAchievement / knownWeight) * 100) : null;
  const knownCoverage = totalWeight ? clampScore((knownWeight / totalWeight) * 100) : 0;
  const evidenceCoverage = totalWeight ? clampScore((evidencedWeight / totalWeight) * 100) : 0;
  const scoringStatus = !scoringEligible || requirements.length === 0
    ? 'not_eligible' as const
    : knownCoverage >= config.scoring.minKnownCoverageForReady
        && evidenceCoverage >= config.scoring.minEvidenceCoverageForReady
      ? 'ready' as const
      : 'insufficient_evidence' as const;
  const score = scoringStatus === 'ready' ? rawScore : null;
  const confidence = scoringStatus === 'ready'
    ? clampScore(
        (knownCoverage * config.scoring.confidenceWeights.knownCoverage)
        + (evidenceCoverage * config.scoring.confidenceWeights.evidenceCoverage),
      )
    : null;
  const strengths = dimensionBreakdown
    .filter((item) => item.state === 'met' && (
      !config.strengths.requireVerified
      || item.studentEvidence.some((evidence) => evidence.status === 'verified' && evidence.assessedScore != null)
    ))
    .sort((a, b) => b.requirement.weight - a.requirement.weight)
    .slice(0, config.strengths.maxItems);
  const priorityGaps = dimensionBreakdown
    .filter((item) => item.state !== 'met')
    .sort((a, b) => Number(b.requirement.required) - Number(a.requirement.required)
      || b.requirement.weight - a.requirement.weight
      || (b.gap ?? -1) - (a.gap ?? -1))
    .slice(0, config.priorityGaps.maxItems);

  return {
    score,
    rawScore,
    evidenceCoverage,
    knownCoverage,
    knownWeight,
    totalWeight,
    scoringStatus,
    confidence,
    dimensionBreakdown,
    strengths,
    priorityGaps,
  };
}
