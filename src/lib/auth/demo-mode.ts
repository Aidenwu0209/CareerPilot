import {
  buildFingerprintCookie,
  FINGERPRINT_STORAGE_KEY,
} from './providers/fingerprint';

export type DemoIdentity = 'student' | 'teacher';

export const DEMO_FINGERPRINTS: Record<DemoIdentity, string> = {
  student: 'demo-fingerprint',
  teacher: 'teacher-demo-fingerprint',
};

export function isDemoFingerprint(value: string | null | undefined): value is string {
  return Object.values(DEMO_FINGERPRINTS).includes(value as string);
}

export function persistDemoIdentity(identity: DemoIdentity): void {
  const fingerprint = DEMO_FINGERPRINTS[identity];
  localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  document.cookie = buildFingerprintCookie(
    fingerprint,
    window.location.protocol === 'https:',
  );
}

export function clearDemoIdentity(): void {
  localStorage.removeItem(FINGERPRINT_STORAGE_KEY);
  document.cookie = `${FINGERPRINT_STORAGE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function demoIdentityDestination(locale: string, identity: DemoIdentity): string {
  return `/${locale}/${identity === 'teacher' ? 'teacher' : 'dashboard'}`;
}
