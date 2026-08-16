import { describe, expect, it } from 'vitest';
import rawConfig from '../../../careerpilot-data/matching-config.json';
import {
  ABILITY_DIMENSION_ORDER,
  CAREER_MATCHING_CONFIG,
  DIMENSION_NAMES,
  parseCareerMatchingConfig,
} from './matching-config';
import { CAREER_DIMENSION_ENUM } from '@/lib/db/schema-career';

describe('career matching configuration', () => {
  it('loads every ordered dimension and its display name from the versioned JSON file', () => {
    expect(CAREER_MATCHING_CONFIG.version).toBe(rawConfig.version);
    expect(ABILITY_DIMENSION_ORDER).toEqual(rawConfig.dimensions.map((dimension) => dimension.code));
    expect(CAREER_DIMENSION_ENUM).toEqual(ABILITY_DIMENSION_ORDER);
    expect(DIMENSION_NAMES.growth_potential).toBe('学习与发展潜力');
    expect(Object.isFrozen(CAREER_MATCHING_CONFIG)).toBe(true);
  });

  it('rejects missing dimensions and confidence weights that do not sum to one', () => {
    expect(() => parseCareerMatchingConfig({
      ...rawConfig,
      dimensions: rawConfig.dimensions.slice(1),
      scoring: {
        ...rawConfig.scoring,
        confidenceWeights: { knownCoverage: 0.8, evidenceCoverage: 0.8 },
      },
    })).toThrow();
  });
});
