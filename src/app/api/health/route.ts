import { NextResponse } from 'next/server';
import { dbReady, db } from '@/lib/db';
import { config } from '@/lib/config';
import { checkReadiness } from '@/lib/readiness';
import { validateEnv } from '@/lib/env';
import { validateBackupConfig } from '@/lib/backup/types';

/**
 * Readiness / health check endpoint.
 *
 * Returns 200 when the app is ready to serve traffic:
 * - The process is running (trivially true if this route responds)
 * - The database is initialized and reachable
 * - PostgreSQL migrations are up to date with the code's migration set
 *
 * Returns 503 when the app is NOT ready.
 *
 * The response also includes a production checklist with safe, non-sensitive
 * configuration status (auth mode, db type, migration status, secret presence,
 * public routes, backup status).
 *
 * NEVER exposes connection strings, secrets, user data, or internal errors.
 */
export async function GET() {
  const readiness = await checkReadiness({
    dbReady,
    db,
    dbType: config.db.type,
  });

  const checklist = buildChecklist(readiness);

  const body: Record<string, unknown> = {
    status: readiness.ok ? 'ok' : 'unavailable',
    checks: readiness.checks,
    checklist,
  };

  if (readiness.migration) {
    body.migration = readiness.migration;
  }

  return NextResponse.json(body, { status: readiness.ok ? 200 : 503 });
}

/**
 * Build a safe production checklist with no sensitive values.
 *
 * Only reports presence/absence of secrets, not the values themselves.
 */
function buildChecklist(readiness: Awaited<ReturnType<typeof checkReadiness>>): Record<string, unknown> {
  const envResult = validateEnv();
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    authMode: config.auth.enabled ? 'oauth+email' : 'fingerprint',
    dbType: config.db.type,
    migration: {
      expected: readiness.migration?.expected ?? null,
      applied: readiness.migration?.applied ?? null,
      upToDate: readiness.checks.migrations,
    },
    secrets: {
      authSecret: process.env.AUTH_SECRET ? 'set' : 'missing',
      aiCredentialKey: process.env.AI_CREDENTIAL_MASTER_KEY
        ? 'set'
        : 'missing',
      googleOAuth:
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
          ? 'set'
          : 'missing',
    },
    publicRoutes: {
      pages: ['/', '/login', '/privacy', '/terms'],
      api: ['/api/auth', '/api/health', '/api/share'],
    },
    backup: {
      configured: process.env.BACKUP_ENABLED === 'true',
      destination: process.env.BACKUP_DESTINATION ? 'set' : 'missing',
      retentionDays: process.env.BACKUP_RETENTION_DAYS || null,
      ownerSet: process.env.BACKUP_OWNER_EMAIL ? true : false,
      encryptionKeySet: process.env.BACKUP_ENCRYPTION_KEY ? true : false,
      configIssues: validateBackupConfig(process.env).issues.length,
    },
    env: {
      production: isProduction,
      configIssues: envResult.issues.length,
    },
  };
}
