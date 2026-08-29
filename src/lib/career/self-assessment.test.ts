import { describe, expect, it } from 'vitest';
import { CAREER_ASSESSMENT_QUESTIONS, isAssessmentComplete, scoreSelfAssessment } from './self-assessment';

describe('career self assessment', () => {
  it('contains the full three-part assessment bank', () => {
    expect(CAREER_ASSESSMENT_QUESTIONS.filter((question) => question.section === 'interests')).toHaveLength(30);
    expect(CAREER_ASSESSMENT_QUESTIONS.filter((question) => question.section === 'personality')).toHaveLength(12);
    expect(CAREER_ASSESSMENT_QUESTIONS.filter((question) => question.section === 'values')).toHaveLength(16);
  });

  it('requires a valid answer for every question', () => {
    const answers = Object.fromEntries(CAREER_ASSESSMENT_QUESTIONS.map((question) => [question.id, 4]));
    expect(isAssessmentComplete(answers)).toBe(true);
    delete answers[CAREER_ASSESSMENT_QUESTIONS[0].id];
    expect(isAssessmentComplete(answers)).toBe(false);
  });

  it('scores preferences without producing an evidence-based ability score', () => {
    const answers = Object.fromEntries(CAREER_ASSESSMENT_QUESTIONS.map((question) => [question.id, 3]));
    answers['personality-ei'] = 1;
    answers['personality-sn'] = 5;
    answers['personality-tf'] = 1;
    answers['personality-jp'] = 5;
    expect(scoreSelfAssessment(answers)).toMatchObject({ personalityType: 'INTP' });
  });

  it('aggregates repeated dimension questions into unique result codes', () => {
    const answers = Object.fromEntries(CAREER_ASSESSMENT_QUESTIONS.map((question) => [question.id, 2]));
    for (const question of CAREER_ASSESSMENT_QUESTIONS.filter((item) => item.code === 'investigative')) answers[question.id] = 5;
    const result = scoreSelfAssessment(answers);
    expect(result.interestCodes[0]).toBe('investigative');
    expect(new Set(result.interestCodes).size).toBe(result.interestCodes.length);
  });
});
