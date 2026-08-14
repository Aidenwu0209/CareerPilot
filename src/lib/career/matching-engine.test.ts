import { describe, expect, it } from 'vitest';
import type { CareerAbility, OccupationRequirement } from '@/types/career';
import { calculateCareerMatch } from './matching-engine';
import { CAREER_MATCHING_CONFIG } from './matching-config';

const requirements: OccupationRequirement[] = [
  { abilityCode: 'a', abilityName: 'A', dimension: 'professional_skills', targetScore: 80, weight: 60, required: true, description: '' },
  { abilityCode: 'b', abilityName: 'B', dimension: 'general_competencies', targetScore: 50, weight: 40, required: false, description: '' },
];

function ability(code: string, score: number | null, verified = false): CareerAbility {
  return {
    code,
    name: code,
    dimension: 'professional_skills',
    score,
    status: score == null ? 'unknown' : 'known',
    confidence: null,
    evidenceCount: verified ? 1 : 0,
    evidence: verified ? [{
      id: `${code}-evidence`, abilityCode: code, sourceType: 'manual', sourceId: null,
      title: 'Evidence', excerpt: '', sourceUrl: null, status: 'verified', assessedScore: score,
      reviewReason: '', reviewedAt: null, occurredAt: null, createdAt: new Date(0).toISOString(),
    }] : [],
    updatedAt: new Date(0).toISOString(),
  };
}

describe('calculateCareerMatch', () => {
  it('calculates readiness, score and confidence from centralized configuration', () => {
    const result = calculateCareerMatch(requirements, [ability('a', 80, true)], true);
    expect(result.scoringStatus).toBe('ready');
    expect(result.score).toBe(100);
    expect(result.knownCoverage).toBe(60);
    expect(result.evidenceCoverage).toBe(60);
    expect(result.confidence).toBe(60);
  });

  it('withholds a score when evidence coverage is below the configured threshold', () => {
    const result = calculateCareerMatch(requirements, [ability('a', 80)], true);
    expect(result.scoringStatus).toBe('insufficient_evidence');
    expect(result.rawScore).toBe(100);
    expect(result.score).toBeNull();
  });

  it('honors an injected versioned configuration', () => {
    const result = calculateCareerMatch(requirements, [ability('a', 80, true)], true, {
      ...CAREER_MATCHING_CONFIG,
      readiness: { minimumKnownCoverage: 80, minimumEvidenceCoverage: 80 },
    });
    expect(result.scoringStatus).toBe('insufficient_evidence');
  });
});
