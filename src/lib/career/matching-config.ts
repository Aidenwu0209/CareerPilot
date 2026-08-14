import { CAREER_DIMENSIONS, type AbilityDimensionCode } from '@/types/career';

export interface CareerMatchingConfig {
  algorithmVersion: string;
  readiness: {
    minimumKnownCoverage: number;
    minimumEvidenceCoverage: number;
  };
  confidenceWeights: {
    knownCoverage: number;
    evidenceCoverage: number;
  };
  maximumHighlights: number;
}

export const CAREER_MATCHING_CONFIG: Readonly<CareerMatchingConfig> = {
  algorithmVersion: 'career-match-v2',
  readiness: {
    minimumKnownCoverage: 50,
    minimumEvidenceCoverage: 40,
  },
  confidenceWeights: {
    knownCoverage: 0.4,
    evidenceCoverage: 0.6,
  },
  maximumHighlights: 3,
};

export const ABILITY_DIMENSION_ORDER: readonly AbilityDimensionCode[] = CAREER_DIMENSIONS;
