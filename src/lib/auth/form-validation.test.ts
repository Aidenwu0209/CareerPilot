import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  isValidOtpCode,
  validateOnboardingField,
  validateOnboardingProfile,
} from './form-validation';

describe('auth form validation', () => {
  it('validates email and six-digit OTP formats before network submission', () => {
    expect(isValidEmail('student@example.com')).toBe(true);
    expect(isValidEmail('student@localhost')).toBe(false);
    expect(isValidOtpCode('123456')).toBe(true);
    expect(isValidOtpCode('12345')).toBe(false);
    expect(isValidOtpCode('12345a')).toBe(false);
  });

  it('reports onboarding errors per field using server-aligned limits', () => {
    expect(validateOnboardingField('name', '   ')).toBe('required');
    expect(validateOnboardingField('name', 'a'.repeat(81))).toBe('tooLong');
    expect(validateOnboardingField('careerDirection', 'a'.repeat(240))).toBeNull();

    expect(validateOnboardingProfile({
      name: 'Ada',
      school: '',
      major: 'Computer Science',
      academicStage: '2027',
      careerDirection: 'Software engineering',
    })).toEqual({ school: 'required' });
  });
});
