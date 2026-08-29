import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { logger } from '@/lib/observability/logger';

interface Journal {
  entries: Array<{ tag: string; when: number }>;
}

/**
 * A development database created immediately before commit 16092c6 contains
 * the final 0016 schema but records the generator's pre-commit timestamp/hash.
 * Drizzle compares only timestamps and otherwise attempts to create the same
 * tables again. This alias is intentionally exact and cannot baseline unknown
 * databases or future migration edits.
 */
const LEGACY_CAREER_MIGRATION = {
  hash: '64bf8eb0bbf045905e84b2bbfbb528610bb0df2c72e010a88b5ed83da1d9bc89',
  createdAt: 1_786_438_815_157,
  currentTag: '0016_tidy_tomorrow_man',
  currentHash: '11192ac4cdda0aa94a052280ddf1cbab23e120ddf3cf7693d306326213f81e19',
  currentCreatedAt: 1_786_439_082_143,
} as const;

const CAREER_BASELINE_TABLES = [
  'career_abilities',
  'career_evidence',
  'career_goals',
  'career_guidance_notes',
  'career_knowledge_documents',
  'career_matches',
  'career_profile_snapshots',
  'career_profiles',
  'career_tasks',
  'education_role_assignments',
  'occupation_relations',
  'occupation_requirements',
  'occupations',
  'teacher_student_assignments',
] as const;

function tableColumns(sqlite: Database.Database, table: string): Set<string> {
  const escaped = table.replaceAll("'", "''");
  const rows = sqlite.prepare(`PRAGMA table_info('${escaped}')`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function reconcileKnownLegacySQLiteMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  const migrationTable = sqlite.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
  ).get() as { present: number } | undefined;
  // A fresh database has no journal yet; the normal Drizzle migrator creates it.
  if (!migrationTable) return false;
  const latest = sqlite.prepare(
    'SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
  ).get() as { hash?: string; createdAt?: number } | undefined;
  if (latest?.hash !== LEGACY_CAREER_MIGRATION.hash
      || Number(latest.createdAt) !== LEGACY_CAREER_MIGRATION.createdAt) {
    return false;
  }

  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as Journal;
  const index = journal.entries.findIndex((entry) => entry.tag === LEGACY_CAREER_MIGRATION.currentTag);
  const current = index >= 0 ? readMigrationFiles({ migrationsFolder })[index] : undefined;
  if (!current
      || current.hash !== LEGACY_CAREER_MIGRATION.currentHash
      || current.folderMillis !== LEGACY_CAREER_MIGRATION.currentCreatedAt) {
    logger.warn('db.sqlite_legacy_migration_alias_rejected', { reason: 'current_migration_changed' });
    return false;
  }

  const placeholders = CAREER_BASELINE_TABLES.map(() => '?').join(', ');
  const tableCount = sqlite.prepare(
    `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
  ).get(...CAREER_BASELINE_TABLES) as { count: number };
  const occupationColumns = tableColumns(sqlite, 'occupations');
  const evidenceColumns = tableColumns(sqlite, 'career_evidence');
  const hasExpectedPre0017Shape = tableCount.count === CAREER_BASELINE_TABLES.length
    && occupationColumns.has('entry_level')
    && !occupationColumns.has('catalog_version')
    && evidenceColumns.has('status');
  if (!hasExpectedPre0017Shape) {
    logger.warn('db.sqlite_legacy_migration_alias_rejected', { reason: 'schema_signature_mismatch' });
    return false;
  }

  sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  ).run(current.hash, current.folderMillis);
  logger.warn('db.sqlite_legacy_migration_reconciled', {
    migration: LEGACY_CAREER_MIGRATION.currentTag,
  });
  return true;
}
