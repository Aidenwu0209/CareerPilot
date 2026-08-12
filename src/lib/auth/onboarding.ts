import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { recordAllConsents } from '@/lib/legal/consent-service';

export interface OnboardingProfile {
  name: string;
  school: string;
  major: string;
  academicStage: string;
  careerDirection: string;
}

export interface OnboardingSettings extends Partial<OnboardingProfile> {
  onboardingRequired?: boolean;
  onboardingCompletedAt?: string;
}

export class FingerprintAccountMigrationRequiredError extends Error {
  readonly code = 'FINGERPRINT_ACCOUNT_MIGRATION_REQUIRED';

  constructor() {
    super(
      'A legacy fingerprint account uses this email. Sign in is blocked until support verifies and binds the accounts explicitly.',
    );
    this.name = 'FingerprintAccountMigrationRequiredError';
  }
}

export function readOnboardingSettings(settings: unknown): OnboardingSettings {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  return settings as OnboardingSettings;
}

export function isOnboardingRequired(settings: unknown): boolean {
  return readOnboardingSettings(settings).onboardingRequired === true;
}

export function assertRealAccountCanLink(user: { authType: string }): void {
  if (user.authType === 'fingerprint') {
    throw new FingerprintAccountMigrationRequiredError();
  }
}

export function validateOnboardingProfile(input: unknown):
  | { success: true; data: OnboardingProfile }
  | { success: false; fields: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, fields: ['name', 'school', 'major', 'academicStage', 'careerDirection'] };
  }

  const body = input as Record<string, unknown>;
  const limits: Record<keyof OnboardingProfile, number> = {
    name: 80,
    school: 160,
    major: 160,
    academicStage: 80,
    careerDirection: 240,
  };
  const data = {} as OnboardingProfile;
  const fields: string[] = [];

  for (const key of Object.keys(limits) as Array<keyof OnboardingProfile>) {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!value || value.length > limits[key]) fields.push(key);
    data[key] = value;
  }

  return fields.length ? { success: false, fields } : { success: true, data };
}

export async function completeOnboarding(params: {
  userId: string;
  profile: OnboardingProfile;
  ipAddress?: string | null;
}): Promise<void> {
  const user = await userRepository.findById(params.userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!isOnboardingRequired(user.settings)) throw new Error('ONBOARDING_NOT_REQUIRED');

  await recordAllConsents({
    userId: params.userId,
    source: 'registration',
    ipAddress: params.ipAddress ?? null,
  });

  const current = readOnboardingSettings(user.settings);
  await db
    .update(users)
    .set({
      name: params.profile.name,
      settings: {
        ...current,
        ...params.profile,
        program: params.profile.major,
        cohort: params.profile.academicStage,
        onboardingRequired: false,
        onboardingCompletedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(users.id, params.userId));
}
