export const ONBOARDING_FIELDS = [
  'name',
  'school',
  'major',
  'academicStage',
  'careerDirection',
] as const;

export type OnboardingField = (typeof ONBOARDING_FIELDS)[number];
export type FieldValidationError = 'required' | 'tooLong';

export const ONBOARDING_FIELD_LIMITS: Record<OnboardingField, number> = {
  name: 80,
  school: 160,
  major: 160,
  academicStage: 80,
  careerDirection: 240,
};

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidOtpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function validateOnboardingField(
  field: OnboardingField,
  value: string,
): FieldValidationError | null {
  const normalized = value.trim();
  if (!normalized) return 'required';
  if (normalized.length > ONBOARDING_FIELD_LIMITS[field]) return 'tooLong';
  return null;
}

export function validateOnboardingProfile(
  values: Record<OnboardingField, string>,
): Partial<Record<OnboardingField, FieldValidationError>> {
  return Object.fromEntries(
    ONBOARDING_FIELDS.flatMap((field) => {
      const error = validateOnboardingField(field, values[field]);
      return error ? [[field, error]] : [];
    }),
  );
}
