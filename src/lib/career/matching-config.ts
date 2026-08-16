import { z } from 'zod';
import configData from '../../../careerpilot-data/matching-config.json';
import { CAREER_DIMENSIONS, type AbilityDimensionCode } from '@/constants/career-dimensions';

const percentageSchema = z.number().min(0).max(100);

const careerMatchingConfigSchema = z.object({
  version: z.string().trim().min(1),
  dimensions: z.array(z.object({
    code: z.enum(CAREER_DIMENSIONS),
    name: z.string().trim().min(1),
    order: z.number().int().positive(),
  })).length(CAREER_DIMENSIONS.length),
  scoring: z.object({
    achievementCapRatio: z.number().positive(),
    minKnownCoverageForReady: percentageSchema,
    minEvidenceCoverageForReady: percentageSchema,
    confidenceWeights: z.object({
      knownCoverage: z.number().min(0).max(1),
      evidenceCoverage: z.number().min(0).max(1),
    }).refine(
      (weights) => Math.abs(weights.knownCoverage + weights.evidenceCoverage - 1) < Number.EPSILON,
      'Confidence weights must add up to 1.',
    ),
  }),
  strengths: z.object({
    maxItems: z.number().int().nonnegative(),
    requireVerified: z.boolean(),
  }),
  priorityGaps: z.object({
    maxItems: z.number().int().nonnegative(),
  }),
}).superRefine((value, context) => {
  const codes = value.dimensions.map((dimension) => dimension.code);
  const orders = value.dimensions.map((dimension) => dimension.order);
  if (new Set(codes).size !== CAREER_DIMENSIONS.length) {
    context.addIssue({ code: 'custom', message: 'Every career dimension must appear exactly once.' });
  }
  if (new Set(orders).size !== orders.length) {
    context.addIssue({ code: 'custom', message: 'Career dimension orders must be unique.' });
  }
  for (const code of CAREER_DIMENSIONS) {
    if (!codes.includes(code)) {
      context.addIssue({ code: 'custom', message: `Missing career dimension: ${code}` });
    }
  }
});

export type CareerMatchingConfig = z.infer<typeof careerMatchingConfigSchema>;

export function parseCareerMatchingConfig(input: unknown): CareerMatchingConfig {
  return careerMatchingConfigSchema.parse(input);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const CAREER_MATCHING_CONFIG = deepFreeze(parseCareerMatchingConfig(configData));

const orderedDimensions = [...CAREER_MATCHING_CONFIG.dimensions].sort((a, b) => a.order - b.order);

export const ABILITY_DIMENSION_ORDER: readonly AbilityDimensionCode[] = orderedDimensions.map((dimension) => dimension.code);

export const DIMENSION_NAMES: Readonly<Record<AbilityDimensionCode, string>> = Object.freeze(
  Object.fromEntries(orderedDimensions.map((dimension) => [dimension.code, dimension.name])) as Record<AbilityDimensionCode, string>,
);
