import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));

import { reconcileKnownLegacySQLiteMigration } from './sqlite-migration-compat';

const tables = [
  'career_abilities', 'career_evidence', 'career_goals', 'career_guidance_notes',
  'career_knowledge_documents', 'career_matches', 'career_profile_snapshots',
  'career_profiles', 'career_tasks', 'education_role_assignments',
  'occupation_relations', 'occupation_requirements', 'occupations',
  'teacher_student_assignments',
];

function legacyDatabase(hash = '64bf8eb0bbf045905e84b2bbfbb528610bb0df2c72e010a88b5ed83da1d9bc89') {
  const sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)');
  for (const table of tables) {
    if (table === 'occupations') sqlite.exec('CREATE TABLE occupations (code TEXT, entry_level TEXT)');
    else if (table === 'career_evidence') sqlite.exec('CREATE TABLE career_evidence (id TEXT, status TEXT)');
    else sqlite.exec(`CREATE TABLE ${table} (id TEXT)`);
  }
  sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run(hash, 1_786_438_815_157);
  return sqlite;
}

describe('known SQLite migration compatibility alias', () => {
  it('records the committed 0016 identity only after the exact legacy hash and schema signature match', () => {
    const sqlite = legacyDatabase();
    expect(reconcileKnownLegacySQLiteMigration(sqlite, resolve('drizzle/migrations'))).toBe(true);
    const latest = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get();
    expect(latest).toEqual({
      hash: '11192ac4cdda0aa94a052280ddf1cbab23e120ddf3cf7693d306326213f81e19',
      created_at: 1_786_439_082_143,
    });
  });

  it('does not modify an unknown migration history', () => {
    const sqlite = legacyDatabase('unknown-hash');
    expect(reconcileKnownLegacySQLiteMigration(sqlite, resolve('drizzle/migrations'))).toBe(false);
    expect(sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 1 });
  });
});
