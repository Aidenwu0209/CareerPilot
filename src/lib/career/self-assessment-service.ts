import 'server-only';

import { userRepository } from '@/lib/db/repositories/user.repository';
import { isAssessmentComplete, scoreSelfAssessment, type CareerSelfAssessment } from './self-assessment';
import { CareerValidationError } from './service';
import { persistAssessmentResults } from './assessment-results';

const SETTINGS_KEY = 'careerSelfAssessment';

export async function getCareerSelfAssessment(userId: string): Promise<CareerSelfAssessment | null> {
  const value = (await userRepository.getSettings(userId))[SETTINGS_KEY];
  if (!value || typeof value !== 'object') return null;
  return value as CareerSelfAssessment;
}

export async function saveCareerSelfAssessment(
  userId: string,
  answers: Record<string, number>,
  complete: boolean,
): Promise<CareerSelfAssessment> {
  const sanitized = Object.fromEntries(
    Object.entries(answers).filter(([, value]) => Number.isInteger(value) && value >= 1 && value <= 5),
  );
  if (complete && !isAssessmentComplete(sanitized)) {
    throw new CareerValidationError('All self-assessment questions are required before completion.');
  }
  const now = new Date().toISOString();
  const previous = await getCareerSelfAssessment(userId);
  const assessment: CareerSelfAssessment = {
    version: 1,
    answers: sanitized,
    completedAt: complete ? now : previous?.completedAt ?? null,
    updatedAt: now,
    results: scoreSelfAssessment(sanitized),
  };
  await userRepository.updateSettings(userId, { [SETTINGS_KEY]: assessment });
  if (complete) await persistAssessmentResults(userId, sanitized);
  return assessment;
}
