/**
 * Production readiness check.
 *
 * Verifies that the instance is healthy enough to receive traffic:
 * 1. Process is running (trivially true if this code executes).
 * 2. Database is reachable and initialized.
 * 3. PostgreSQL migrations are up to date (not behind the code's migration set).
 *
 * The result never contains connection strings, secrets, user data, or
 * internal error details — only boolean flags and numeric migration counts.
 */
import {
  getExpectedPGMigrationCount,
  getAppliedPGMigrationCount,
  type MigrationQueryable,
} from '@/lib/db/migration-status';

export interface ReadinessChecks {
  process: boolean;
  database: boolean;
  migrations: boolean;
}

export interface ReadinessResult {
  ok: boolean;
  checks: ReadinessChecks;
  migration?: {
    expected: number;
    applied: number;
  };
}

export interface ReadinessDeps {
  dbReady: Promise<unknown>;
  db: MigrationQueryable;
  dbType: 'postgresql' | 'sqlite';
}

/**
 * Run all readiness checks and return a structured result.
 *
 * Never throws — failures are captured as `ok: false` with the relevant
 * check flag set to `false`.
 */
export async function checkReadiness(
  deps: ReadinessDeps,
): Promise<ReadinessResult> {
  const result: ReadinessResult = {
    ok: true,
    checks: { process: true, database: false, migrations: false },
  };

  // --- Database connectivity ---
  try {
    await deps.dbReady;
    result.checks.database = true;
  } catch {
    result.ok = false;
    return result;
  }

  // --- Migration version (PostgreSQL only) ---
  if (deps.dbType === 'postgresql') {
    const expected = getExpectedPGMigrationCount();
    const applied = await getAppliedPGMigrationCount(deps.db);
    result.migration = { expected, applied };
    result.checks.migrations = expected > 0 && applied >= expected;
    if (!result.checks.migrations) {
      result.ok = false;
    }
  } else {
    // SQLite (dev adapter) — migration check skipped.
    result.checks.migrations = true;
  }

  return result;
}
