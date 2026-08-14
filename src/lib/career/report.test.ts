import { describe, expect, it } from 'vitest';
import { buildCareerReportMarkdown } from './report';
import type { CareerOverview, CareerPath } from '@/types/career';

describe('career report export', () => {
  it('keeps unknown scores explicit', () => {
    const overview = {
      primaryGoal: null,
      indicators: { readiness: null, match: null, profileCompleteness: 0, evidenceCoverage: 0 },
      generatedAt: '2026-08-14T00:00:00.000Z',
      profile: { dimensions: [] }, abilityChanges: [], nextTasks: [], latestGuidance: [],
    } as unknown as CareerOverview;
    const path = { goal: null, stages: [], currentStageIndex: 0, updatedAt: overview.generatedAt } as CareerPath;
    const markdown = buildCareerReportMarkdown({ overview, path, match: null, assessment: null }, 'zh-CN');
    expect(markdown).toContain('就业准备度: 证据不足');
    expect(markdown).not.toContain('就业准备度: 0%');
  });
});
