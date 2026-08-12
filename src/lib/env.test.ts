import { describe, it, expect, afterEach } from 'vitest';
import { validateEnv } from './env';

/**
 * Config matrix tests for US-001: production fail-closed.
 *
 * Asserts that every unsafe configuration combination is detected,
 * and that safe configurations pass validation.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  // Reset to a clean baseline
  process.env = { ...ORIGINAL_ENV };
  const values = overrides.NODE_ENV === 'production' && !Object.hasOwn(overrides, 'SMTP_HOST')
    ? { ...overrides, SMTP_HOST: 'smtp.example.com' }
    : overrides;
  const completeValues = overrides.NODE_ENV === 'production'
    ? {
        GOOGLE_CLIENT_ID: 'google-client-id',
        GOOGLE_CLIENT_SECRET: 'google-client-secret',
        ...values,
      }
    : values;
  for (const [key, value] of Object.entries(completeValues)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('validateEnv', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // --- Development: always passes (warnings only) ---

  it('passes in development with default (unsafe) values', () => {
    setEnv({
      NODE_ENV: 'development',
      DEMO_MODE: undefined,
      DB_TYPE: undefined,
      AUTH_SECRET: undefined,
      AI_CREDENTIAL_MASTER_KEY: undefined,
    });

    const result = validateEnv();
    expect(result.ok).toBe(true);
  });

  it('passes in development with SQLite and explicit demo mode', () => {
    setEnv({
      NODE_ENV: 'development',
      DEMO_MODE: 'true',
      DB_TYPE: 'sqlite',
      AUTH_SECRET: 'your-auth-secret-key-change-me',
    });

    const result = validateEnv();
    expect(result.ok).toBe(true);
  });

  // --- Production: safe config passes ---

  it('passes in production with all safe values', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
      SMTP_HOST: 'smtp.example.com',
    });

    const result = validateEnv();
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('requires Stripe, OTLP, and on-call configuration when commercial systems are enabled', () => {
    setEnv({
      NODE_ENV: 'production', DEMO_MODE: 'false', DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
      SMTP_HOST: 'smtp.example.com',
      BILLING_ENABLED: 'true', APM_ENABLED: 'true', EXTERNAL_ALERTS_ENABLED: 'true',
      STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, APP_URL: undefined,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined, ALERT_WEBHOOK_URL: undefined,
      ONCALL_EMAILS: undefined, CRON_SECRET: undefined,
    });
    const fields = new Set(validateEnv().issues.map((issue) => issue.field));
    expect(fields).toEqual(new Set([
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'APP_URL',
      'OTEL_EXPORTER_OTLP_ENDPOINT', 'ALERT_WEBHOOK_URL', 'CRON_SECRET',
    ]));
  });

  // --- Production: each unsafe condition fails ---

  it('fails in production when demo mode is enabled', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'DEMO_MODE')).toBe(true);
  });

  it('uses product mode by default when DEMO_MODE is missing', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: undefined,
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.field === 'DEMO_MODE')).toBe(false);
  });

  it('fails in production when DB_TYPE is sqlite', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'sqlite',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'DB_TYPE')).toBe(true);
  });

  it('fails in production when DB_TYPE is missing (defaults to sqlite)', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: undefined,
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'DB_TYPE')).toBe(true);
  });

  it('fails in production when DATABASE_URL is missing with postgresql', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: undefined,
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'DATABASE_URL')).toBe(true);
  });

  it('fails in production when AUTH_SECRET is missing', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: undefined,
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'AUTH_SECRET')).toBe(true);
  });

  it('fails in production when AUTH_SECRET is a known placeholder', () => {
    const placeholders = [
      'your-auth-secret-key-change-me',
      'change-me-in-production',
      'secret',
      'test',
      'changeme',
      'placeholder',
    ];

    for (const placeholder of placeholders) {
      setEnv({
        NODE_ENV: 'production',
        DEMO_MODE: 'false',
        DB_TYPE: 'postgresql',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        AUTH_SECRET: placeholder,
        AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
      });

      const result = validateEnv();
      expect(result.ok, `placeholder "${placeholder}" should fail`).toBe(false);
      expect(result.issues.some((i) => i.field === 'AUTH_SECRET')).toBe(true);
    }
  });

  it('fails in production when AUTH_SECRET is too short (< 32 chars)', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'short-but-unique-key',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'AUTH_SECRET')).toBe(true);
  });

  it('fails in production when AI_CREDENTIAL_MASTER_KEY is missing', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: undefined,
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'AI_CREDENTIAL_MASTER_KEY')).toBe(true);
  });

  it('fails in production when AI_CREDENTIAL_MASTER_KEY equals AUTH_SECRET', () => {
    const sharedSecret = 'a-very-long-and-secure-production-secret-key-32+chars';
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: sharedSecret,
      AI_CREDENTIAL_MASTER_KEY: sharedSecret,
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'AI_CREDENTIAL_MASTER_KEY')).toBe(true);
  });

  it('fails in production when AI_CREDENTIAL_MASTER_KEY is too short', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'short-key',
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.field === 'AI_CREDENTIAL_MASTER_KEY')).toBe(true);
  });

  // --- Multiple issues at once ---

  it('reports all issues when everything is wrong in production', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      DB_TYPE: 'sqlite',
      DATABASE_URL: undefined,
      AUTH_SECRET: 'your-auth-secret-key-change-me',
      AI_CREDENTIAL_MASTER_KEY: undefined,
    });

    const result = validateEnv();
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
    const fields = result.issues.map((i) => i.field);
    expect(fields).toContain('DEMO_MODE');
    expect(fields).toContain('DB_TYPE');
    expect(fields).toContain('AUTH_SECRET');
    expect(fields).toContain('AI_CREDENTIAL_MASTER_KEY');
  });

  it('requires SMTP delivery for product email verification in production', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
      SMTP_HOST: undefined,
    });
    expect(validateEnv().issues.some((issue) => issue.field === 'SMTP_HOST')).toBe(true);
  });

  it('requires Google OAuth credentials in production product mode', () => {
    setEnv({
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      DB_TYPE: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      AUTH_SECRET: 'a-very-long-and-secure-production-secret-key-32+chars',
      AI_CREDENTIAL_MASTER_KEY: 'a-different-very-long-encryption-key-32+chars',
      SMTP_HOST: 'smtp.example.com',
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(validateEnv().issues.some((issue) => issue.field === 'GOOGLE_CLIENT_ID')).toBe(true);
  });
});
