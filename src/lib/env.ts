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

  // --- AUTH_ENABLED ---
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  if (prod && !authEnabled) {
    issues.push({
      field: 'AUTH_ENABLED',
      message:
        'AUTH_ENABLED must be "true" in production. Fingerprint authentication is not allowed.',
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
