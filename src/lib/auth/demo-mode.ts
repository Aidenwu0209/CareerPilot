import {
  buildFingerprintCookie,
  FINGERPRINT_STORAGE_KEY,
} from './providers/fingerprint';

export type DemoIdentity = 'student' | 'teacher';

export const DEMO_FINGERPRINTS: Record<DemoIdentity, string> = {
  student: 'demo-fingerprint',
  teacher: 'teacher-demo-fingerprint',
};

export function normalizeInternalCallbackUrl(
  candidate: string | null,
  fallback: string,
): string {
  if (!candidate?.startsWith('/') || candidate.startsWith('//')) return fallback;

  try {
    const base = new URL('https://careerpilot.local');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function persistDemoIdentity(identity: DemoIdentity): void {
  const fingerprint = DEMO_FINGERPRINTS[identity];
  localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  document.cookie = buildFingerprintCookie(
    fingerprint,
    window.location.protocol === 'https:',
  );
}

export function demoIdentityDestination(locale: string, identity: DemoIdentity): string {
  return `/${locale}/${identity === 'teacher' ? 'teacher' : 'dashboard'}`;
}
