import { describe, expect, it } from 'vitest';
import {
  DEMO_FINGERPRINTS,
  demoIdentityDestination,
  normalizeInternalCallbackUrl,
} from './demo-mode';

describe('demo mode navigation', () => {
  it('uses the seeded fingerprints for student and teacher demos', () => {
    expect(DEMO_FINGERPRINTS).toEqual({
      student: 'demo-fingerprint',
      teacher: 'teacher-demo-fingerprint',
    });
  });

  it('builds locale-aware destinations', () => {
    expect(demoIdentityDestination('zh', 'student')).toBe('/zh/dashboard');
    expect(demoIdentityDestination('en', 'teacher')).toBe('/en/teacher');
  });

  it.each([
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    'dashboard',
  ])('rejects unsafe callback URL %s', (candidate) => {
    expect(normalizeInternalCallbackUrl(candidate, '/zh/dashboard')).toBe('/zh/dashboard');
  });

  it('preserves a safe local callback path and query', () => {
    expect(
      normalizeInternalCallbackUrl('/zh/account?tab=billing', '/zh/dashboard'),
    ).toBe('/zh/account?tab=billing');
  });
});
