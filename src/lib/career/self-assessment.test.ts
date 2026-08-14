import { describe, expect, it } from 'vitest';
import { CAREER_ASSESSMENT_QUESTIONS, isAssessmentComplete, scoreSelfAssessment } from './self-assessment';

describe('career self assessment', () => {
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
});
