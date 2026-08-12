import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let sqlite: Database.Database | null = null;

afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

describe('SQLite career evidence assessment migration', () => {
  it('upgrades the pre-assessment table, preserves rows, and enforces the 0-100 database check', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE users (id text PRIMARY KEY NOT NULL);
      CREATE TABLE career_evidence (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ability_code text NOT NULL,
        source_type text NOT NULL,
        source_id text,
        title text NOT NULL,
        excerpt text DEFAULT '' NOT NULL,
        source_url text,
        status text DEFAULT 'pending' NOT NULL,
        reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
        review_reason text DEFAULT '' NOT NULL,
        reviewed_at integer,
        occurred_at integer,
        created_at integer DEFAULT (unixepoch()) NOT NULL
      );
      INSERT INTO users(id) VALUES ('student-upgrade');
      INSERT INTO career_evidence(id,user_id,ability_code,source_type,title)
        VALUES ('evidence-upgrade','student-upgrade','communication','manual','升级前证据');
    `);

    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/migrations/0018_career_evidence_assessment.sql'),
      'utf8',
    ).replaceAll('--> statement-breakpoint', '');
    sqlite.exec(migration);

    expect(sqlite.prepare('SELECT id, assessed_score FROM career_evidence').get()).toEqual({
      id: 'evidence-upgrade',
      assessed_score: null,
    });
    expect(() => sqlite!.prepare('UPDATE career_evidence SET assessed_score = 101 WHERE id = ?').run('evidence-upgrade')).toThrow();
    expect(() => sqlite!.prepare('UPDATE career_evidence SET assessed_score = -1 WHERE id = ?').run('evidence-upgrade')).toThrow();
    sqlite.prepare('UPDATE career_evidence SET assessed_score = 100 WHERE id = ?').run('evidence-upgrade');
  });
});
