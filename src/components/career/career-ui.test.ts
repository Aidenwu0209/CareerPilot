import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('career UI product rules', () => {
  it('renders only API-provided active catalog facets and keeps pagination controls', () => {
    const browser = readFileSync(join(root, 'src/components/career/occupation-browser.tsx'), 'utf8');
    for (const field of [
      'collegeCode', 'majorCode', 'jobFamily', 'industry', 'city',
      'educationLevel', 'relevanceType', 'relationType',
    ]) {
      expect(browser).toContain(field);
    }
    expect(browser).toContain('pageInfo.hasMore');
    expect(browser).toContain('next.size < 3');
    expect(browser).toContain('options.length > 0');
    expect(browser).toContain("responseKey: 'relevanceTypes'");
    expect(browser).toContain("responseKey: 'relationTypes'");
    expect(browser).not.toContain("(['primary', 'adjacent', 'cross_major', 'stretch']");
    expect(browser).not.toContain("(['progresses_to', 'transfers_to', 'related_to']");
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

  it('limits goals and comparison to scoreable occupations while preserving legacy goal context', () => {
    const goalForm = readFileSync(join(root, 'src/components/career/goal-form.tsx'), 'utf8');
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    expect(goalForm).toContain('occupation.scoringEligible === true');
    expect(goalForm).toContain('currentGoalUnavailable');
    expect(matching).toContain('occupation.scoringEligible === true');
    expect(matching).toContain('selectedUnavailableOccupation');
  });

  it('supports student evidence submission without any self-score input', () => {
    const submission = readFileSync(join(root, 'src/components/career/career-evidence-submission-form.tsx'), 'utf8');
    const matching = readFileSync(join(root, 'src/app/[locale]/career/matching/page.tsx'), 'utf8');
    const profile = readFileSync(join(root, 'src/app/[locale]/career/profile/page.tsx'), 'utf8');
    expect(submission).toContain("fetch('/api/career/evidence'");
    expect(submission).toContain('occupationCode');
    expect(submission).toContain('abilityCode');
    expect(submission).toContain('sourceUrl');
    expect(submission).not.toContain('name="score"');
    expect(matching).toContain('CareerEvidenceSubmissionForm');
    expect(profile).toContain('CareerEvidenceSubmissionForm');
    expect(profile).toContain('evidence.assessedScore');
    expect(profile).toContain('evidence.reviewReason');
  });

  it('requires teachers to score confirmed evidence from zero to one hundred', () => {
    const review = readFileSync(join(root, 'src/components/teacher/evidence-review-form.tsx'), 'utf8');
    const detail = readFileSync(join(root, 'src/components/teacher/teacher-student-detail.tsx'), 'utf8');
    expect(review).toContain('name="score"');
    expect(review).toContain('min={0}');
    expect(review).toContain('max={100}');
    expect(review).toContain("decision === 'confirmed' ? { score } : {}");
    expect(detail).toContain('evidence.assessedScore');
    expect(detail).toContain('evidence.reviewReason');
    expect(detail).toContain('aria-valuemax={100}');
  });
});
