/**
 * Environment configuration validation.
 *
 * In production, the app MUST fail to start when security-critical
 * configuration is missing or unsafe (fail-closed).
 *
 * In development, unsafe defaults are allowed with a console warning.
 */

const PLACEHOLDER_AUTH_SECRETS = new Set([
  '',
  'your-auth-secret-key-change-me',
  'change-me-in-production',
  'secret',
  'test',
  'changeme',
  'placeholder',
  'generate-a-secret-key',
]);

export interface EnvValidationIssue {
  field: string;
  message: string;
}

export interface EnvValidationResult {
  ok: boolean;
  issues: EnvValidationIssue[];
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validate environment configuration.
 *
 * Returns a result object with all issues found.
 * Does not throw — callers decide whether to throw or warn.
 */
export function validateEnv(): EnvValidationResult {
  const issues: EnvValidationIssue[] = [];
  const prod = isProduction();

  // Demo identities must never be enabled in production.
  if (prod && process.env.DEMO_MODE === 'true') {
    issues.push({
      field: 'DEMO_MODE',
      message: 'DEMO_MODE must not be enabled in production.',
    });
  }

  if (prod && !process.env.SMTP_HOST) {
    issues.push({
      field: 'SMTP_HOST',
      message: 'SMTP_HOST is required for product email verification.',
    });
  }

  if (prod && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
    issues.push({
      field: 'GOOGLE_CLIENT_ID',
      message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for product Google login.',
    });
  }

  // --- DB_TYPE ---
  const dbType = process.env.DB_TYPE || 'sqlite';

  if (prod && dbType !== 'postgresql') {
    issues.push({
      field: 'DB_TYPE',
      message:
        'DB_TYPE must be "postgresql" in production. SQLite is not allowed.',
    });
  }

  // --- DATABASE_URL ---
  if (prod && dbType === 'postgresql' && !process.env.DATABASE_URL) {
    issues.push({
      field: 'DATABASE_URL',
      message: 'DATABASE_URL is required when DB_TYPE=postgresql.',
    });
  }

  // --- AUTH_SECRET ---
  const authSecret = process.env.AUTH_SECRET || '';

  if (prod) {
    if (!authSecret) {
      issues.push({
        field: 'AUTH_SECRET',
        message: 'AUTH_SECRET must be set in production.',
      });
    } else if (PLACEHOLDER_AUTH_SECRETS.has(authSecret)) {
      issues.push({
        field: 'AUTH_SECRET',
        message:
          'AUTH_SECRET is set to a known placeholder value. Generate a strong, unique secret.',
      });
    } else if (authSecret.length < 32) {
      issues.push({
        field: 'AUTH_SECRET',
        message: 'AUTH_SECRET must be at least 32 characters long.',
      });
    }
  }

  // --- AI_CREDENTIAL_MASTER_KEY ---
  // Must be independent from AUTH_SECRET for encrypting provider credentials.
  const aiKey = process.env.AI_CREDENTIAL_MASTER_KEY || '';

  if (prod) {
    if (!aiKey) {
      issues.push({
        field: 'AI_CREDENTIAL_MASTER_KEY',
        message:
          'AI_CREDENTIAL_MASTER_KEY must be set in production for encrypting AI provider credentials.',
      });
    } else if (aiKey === authSecret) {
      issues.push({
        field: 'AI_CREDENTIAL_MASTER_KEY',
        message:
          'AI_CREDENTIAL_MASTER_KEY must be different from AUTH_SECRET.',
      });
    } else if (aiKey.length < 32) {
      issues.push({
        field: 'AI_CREDENTIAL_MASTER_KEY',
        message:
          'AI_CREDENTIAL_MASTER_KEY must be at least 32 characters long.',
      });
    }
  }

  // Commercial subsystems are opt-in, but become fail-closed once enabled.
  if (prod && process.env.BILLING_ENABLED === 'true') {
    for (const field of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'APP_URL']) {
      if (!process.env[field]) {
        issues.push({ field, message: `${field} is required when BILLING_ENABLED=true.` });
      }
    }
  }
  if (prod && process.env.APM_ENABLED === 'true' && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    issues.push({ field: 'OTEL_EXPORTER_OTLP_ENDPOINT', message: 'An OTLP collector endpoint is required when APM_ENABLED=true.' });
  }
  if (prod && process.env.IMAGE_4K_ENABLED === 'true') {
    if (!process.env.IMAGE_UPSCALER_API_KEY) {
      issues.push({ field: 'IMAGE_UPSCALER_API_KEY', message: 'A dedicated upscaler credential is required when IMAGE_4K_ENABLED=true.' });
    }
    if (!process.env.AI_UPSTREAM_ALLOWED_DOMAINS) {
      issues.push({ field: 'AI_UPSTREAM_ALLOWED_DOMAINS', message: 'Allow-list the 4K upscaler hostname when IMAGE_4K_ENABLED=true.' });
    }
  }
  if (prod && process.env.EXTERNAL_ALERTS_ENABLED === 'true') {
    if (!process.env.ALERT_WEBHOOK_URL && !process.env.ONCALL_EMAILS) {
      issues.push({ field: 'ALERT_WEBHOOK_URL', message: 'Configure ALERT_WEBHOOK_URL or ONCALL_EMAILS when external alerts are enabled.' });
    }
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 24) {
      issues.push({ field: 'CRON_SECRET', message: 'CRON_SECRET of at least 24 characters is required for monitoring checks.' });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Assert that the environment is safe for production.
 * Throws an Error listing all unsafe configuration items.
 *
 * In development, only logs warnings.
 */
export function assertEnvOrExit(): void {
  const result = validateEnv();

  if (result.ok) {
    return;
  }

  const messages = result.issues.map((i) => `  - ${i.field}: ${i.message}`);

  if (isProduction()) {
    // Fail-closed: refuse to start in production with unsafe config.
    const msg =
      `\n` +
      `========================================\n` +
      `PRODUCTION CONFIGURATION CHECK FAILED\n` +
      `========================================\n` +
      `The following configuration issues must be resolved before the app can start:\n` +
      `${messages.join('\n')}\n` +
      `\n` +
      `Refusing to start in production with unsafe configuration.\n`;

    console.error(msg);
    // Use a non-zero exit code to prevent the process from starting.
    process.exit(1);
  } else {
    // Development: warn but continue.
    console.warn(
      '\n⚠️  Development environment has unsafe configuration:\n' +
        messages.join('\n') +
        '\n',
    );
  }
}
