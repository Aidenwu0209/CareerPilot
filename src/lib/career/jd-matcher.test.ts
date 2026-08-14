import { describe, expect, it } from 'vitest';
import { rankOccupationsFromJd } from './jd-matcher';
import type { OccupationSummary } from '@/types/career';

const occupations: OccupationSummary[] = [
  { code: 'a', name: '前端开发工程师', aliases: ['Frontend Engineer'], category: '软件开发', summary: 'Web React TypeScript', matchScore: null },
  { code: 'b', name: '人力资源专员', aliases: ['HR Specialist'], category: '人力资源', summary: '招聘与员工关系', matchScore: null },
];

describe('JD occupation ranking', () => {
  it('prioritizes explicit titles and aliases', () => {
    const result = rankOccupationsFromJd('招聘 Frontend Engineer，负责 React 与 TypeScript 产品开发。', occupations);
    expect(result[0].occupation.code).toBe('a');
    expect(result[0].matchedTerms).toContain('Frontend Engineer');
  });
});
