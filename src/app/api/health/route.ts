import { NextResponse } from 'next/server';
import { dbReady, db } from '@/lib/db';
import { config } from '@/lib/config';
import { checkReadiness } from '@/lib/readiness';
import { validateEnv } from '@/lib/env';
import { validateBackupConfig } from '@/lib/backup/types';

export const dynamic = 'force-dynamic';

/** Readiness endpoint. Never exposes connection strings, secrets, or internal errors. */
export async function GET() {
  const started = Date.now();
  const readiness = await checkReadiness({ dbReady, db, dbType: config.db.type });
  const envResult = validateEnv();
  const ok = readiness.ok && envResult.ok;
  const checks = { ...readiness.checks, configuration: envResult.ok };
  const checklist = buildChecklist(readiness, envResult);
  const body: Record<string, unknown> = {
    status: ok ? 'ok' : 'unavailable',
    checks,
    checklist,
    latencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };
  if (readiness.migration) body.migration = readiness.migration;
  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function buildChecklist(
  readiness: Awaited<ReturnType<typeof checkReadiness>>,
  envResult: ReturnType<typeof validateEnv>,
): Record<string, unknown> {
  return {
    authMode: config.runtime.demoMode ? 'demo' : 'product',
    dbType: config.db.type,
    migration: {
      expected: readiness.migration?.expected ?? null,
      applied: readiness.migration?.applied ?? null,
      upToDate: readiness.checks.migrations,
    },
    secrets: {
      authSecret: process.env.AUTH_SECRET ? 'set' : 'missing',
      aiCredentialKey: process.env.AI_CREDENTIAL_MASTER_KEY ? 'set' : 'missing',
      googleOAuth: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 'set' : 'missing',
      stripe: process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'missing',
      otlp: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'set' : 'missing',
      externalAlerts: process.env.ALERT_WEBHOOK_URL || process.env.ONCALL_EMAILS ? 'set' : 'missing',
    },
    publicRoutes: {
      pages: ['/', '/login', '/privacy', '/terms', ...(config.runtime.demoMode ? ['/demo'] : [])],
      api: ['/api/auth', '/api/health', '/api/share', '/api/webhooks/stripe'],
    },
    backup: {
      configured: process.env.BACKUP_ENABLED === 'true',
      destination: process.env.BACKUP_DESTINATION ? 'set' : 'missing',
      retentionDays: process.env.BACKUP_RETENTION_DAYS || null,
      ownerSet: Boolean(process.env.BACKUP_OWNER_EMAIL),
      encryptionKeySet: Boolean(process.env.BACKUP_ENCRYPTION_KEY),
      configIssues: validateBackupConfig(process.env).issues.length,
    },
    env: { production: process.env.NODE_ENV === 'production', configIssues: envResult.issues.length },
  };
}
