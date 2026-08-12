import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('career UI product rules', () => {
  it('keeps every required catalog filter and pagination control', () => {
    const browser = readFileSync(join(root, 'src/components/career/occupation-browser.tsx'), 'utf8');
    for (const field of [
      'collegeCode', 'majorCode', 'jobFamily', 'industry', 'city',
      'educationLevel', 'relevanceType', 'relationType',
    ]) {
      expect(browser).toContain(field);
    }
    expect(browser).toContain('pageInfo.hasMore');
    expect(browser).toContain('next.size < 3');
  });

  it('does not expose internal algorithm versions or legacy cockpit wording', () => {
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    const zh = readFileSync(join(root, 'messages/zh.json'), 'utf8');
    expect(matching).not.toContain('algorithmVersion');
    expect(matching).not.toContain('career-match-v1');
    expect(zh).not.toContain('驾驶舱');
    expect(zh).not.toContain('家食仓');
  });

  it('requires an explicit goal instead of preselecting the first occupation', () => {
    const goalForm = readFileSync(join(root, 'src/components/career/goal-form.tsx'), 'utf8');
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    expect(goalForm).not.toContain("occupations[0]?.code");
    expect(matching).toContain("codes.length > 0");
    expect(matching).toContain("matching.noGoal.title");
  });

  it('supports low-evidence guidance and two-to-three occupation comparison', () => {
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    expect(matching).toContain('match.score === null');
    expect(matching).toContain('<MaterialSyncButton />');
    expect(matching).toContain('matches.length >= 2');
    expect(matching).toContain('.slice(0, 3)');
    expect(matching).toContain('matching.comparisonTable.title');
  });

  it('separates pending occupation review from insufficient student evidence', () => {
    const browser = readFileSync(join(root, 'src/components/career/occupation-browser.tsx'), 'utf8');
    const detail = readFileSync(join(root, 'src/app/[locale]/career/jobs/[code]/page.tsx'), 'utf8');
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    const zh = JSON.parse(readFileSync(join(root, 'messages/zh.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));

    expect(browser).toContain('occupation.scoringEligible === false');
    expect(detail).toContain('occupation.requirements.length > 0');
    expect(detail).toContain("'review_required'");
    expect(matching).toContain("'not_eligible'");
    expect(matching).toContain('matching.notEligible.title');
    expect(zh.career.common.knowledgePendingReview).toBe('岗位知识待审核');
    expect(zh.career.matching.notEligible.title).toContain('暂不支持评分');
    expect(zh.career.reviewStatus.review_required).toBe('待审核');
    expect(en.career.common.knowledgePendingReview).toBeTruthy();
    expect(en.career.matching.notEligible.description).not.toContain('sync');
    expect(en.career.reviewStatus.review_required).toBe('Review required');
  });
});
