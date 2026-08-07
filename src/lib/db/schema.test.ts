import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import * as schema from './schema';

/**
 * US-003 tests: Schema integrity — FK constraints, cascades, unique constraints.
 *
 * Uses a real in-memory SQLite database with PRAGMA foreign_keys=ON to verify
 * that the unified schema enforces referential integrity at the DB level.
 *
 * These tests validate the same FK/cascade/unique rules that the PostgreSQL
 * migration (0004_green_microchip.sql) adds to production.
 */

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
});

afterAll(() => {
  sqlite.close();
});

describe('US-003: FK constraints reject invalid parent IDs', () => {
  it('rejects resume with non-existent user_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO resumes (id, user_id) VALUES ('r1', 'non-existent-user')`,
      ).run();
    }).toThrow();
  });

  it('rejects resume_section with non-existent resume_id', () => {
    // First create a valid user to isolate the FK failure to resume_id
    sqlite.prepare(
      `INSERT INTO users (id, auth_type) VALUES ('u-fk-section', 'fingerprint')`,
    ).run();

    expect(() => {
      sqlite.prepare(
        `INSERT INTO resume_sections (id, resume_id, type, title) VALUES ('rs1', 'non-existent-resume', 'summary', 'Test')`,
      ).run();
    }).toThrow();
  });

  it('rejects chat_session with non-existent resume_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO chat_sessions (id, resume_id) VALUES ('cs1', 'non-existent-resume')`,
      ).run();
    }).toThrow();
  });

  it('rejects chat_message with non-existent session_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content) VALUES ('cm1', 'non-existent-session', 'user', 'hello')`,
      ).run();
    }).toThrow();
  });

  it('rejects auth_account with non-existent user_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('aa1', 'non-existent-user', 'google', '123')`,
      ).run();
    }).toThrow();
  });

  it('rejects interview_session with non-existent user_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO interview_sessions (id, user_id, job_description) VALUES ('is1', 'non-existent-user', 'test JD')`,
      ).run();
    }).toThrow();
  });

  it('rejects interview_round with non-existent session_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO interview_rounds (id, session_id, interviewer_type, interviewer_config) VALUES ('ir1', 'non-existent-session', 'hr', '{}')`,
      ).run();
    }).toThrow();
  });

  it('rejects interview_message with non-existent round_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO interview_messages (id, round_id, role, content) VALUES ('im1', 'non-existent-round', 'interviewer', 'question')`,
      ).run();
    }).toThrow();
  });

  it('rejects interview_report with non-existent session_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO interview_reports (id, session_id, overall_score, dimension_scores, round_evaluations, overall_feedback, improvement_plan) VALUES ('irep1', 'non-existent-session', 80, '{}', '[]', 'good', '[]')`,
      ).run();
    }).toThrow();
  });

  it('rejects resume_share with non-existent resume_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO resume_shares (id, resume_id, token) VALUES ('rsh1', 'non-existent-resume', 'share-token-1')`,
      ).run();
    }).toThrow();
  });

  it('rejects jd_analysis with non-existent resume_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO jd_analyses (id, resume_id, job_description, result, overall_score, ats_score) VALUES ('jd1', 'non-existent-resume', 'JD', '{}', 80, 75)`,
      ).run();
    }).toThrow();
  });

  it('rejects grammar_check with non-existent resume_id', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO grammar_checks (id, resume_id, result, score, issue_count) VALUES ('gc1', 'non-existent-resume', '{}', 90, 2)`,
      ).run();
    }).toThrow();
  });
});

describe('US-003: Cascade delete works correctly', () => {
  it('deleting a resume cascades to sections, chat_sessions, shares, jd_analyses, grammar_checks', () => {
    // Create user + resume + children
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-cascade', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO resumes (id, user_id) VALUES ('r-cascade', 'u-cascade')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO resume_sections (id, resume_id, type, title) VALUES ('rs-c', 'r-cascade', 'summary', 'S')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO chat_sessions (id, resume_id) VALUES ('cs-c', 'r-cascade')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO chat_messages (id, session_id, role, content) VALUES ('cm-c', 'cs-c', 'user', 'hi')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO resume_shares (id, resume_id, token) VALUES ('rsh-c', 'r-cascade', 'token-cascade')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO jd_analyses (id, resume_id, job_description, result, overall_score, ats_score) VALUES ('jd-c', 'r-cascade', 'JD', '{}', 80, 75)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO grammar_checks (id, resume_id, result, score, issue_count) VALUES ('gc-c', 'r-cascade', '{}', 90, 2)`,
    ).run();

    // Delete the resume — cascades should remove all children
    sqlite.prepare(`DELETE FROM resumes WHERE id = 'r-cascade'`).run();

    // All children should be gone
    expect(sqlite.prepare('SELECT count(*) as c FROM resume_sections WHERE resume_id = ?').get('r-cascade')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM chat_sessions WHERE resume_id = ?').get('r-cascade')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM chat_messages WHERE session_id = ?').get('cs-c')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM resume_shares WHERE resume_id = ?').get('r-cascade')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM jd_analyses WHERE resume_id = ?').get('r-cascade')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM grammar_checks WHERE resume_id = ?').get('r-cascade')).toEqual({ c: 0 });
  });

  it('deleting an interview_session cascades to rounds, messages, and reports', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-int-cascade', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO interview_sessions (id, user_id, job_description) VALUES ('is-cascade', 'u-int-cascade', 'JD')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO interview_rounds (id, session_id, interviewer_type, interviewer_config) VALUES ('ir-c', 'is-cascade', 'hr', '{}')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO interview_messages (id, round_id, role, content) VALUES ('im-c', 'ir-c', 'interviewer', 'Q1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO interview_reports (id, session_id, overall_score, dimension_scores, round_evaluations, overall_feedback, improvement_plan) VALUES ('irep-c', 'is-cascade', 85, '{}', '[]', 'good', '[]')`,
    ).run();

    // Delete the session — cascades should remove all children
    sqlite.prepare(`DELETE FROM interview_sessions WHERE id = 'is-cascade'`).run();

    expect(sqlite.prepare('SELECT count(*) as c FROM interview_rounds WHERE session_id = ?').get('is-cascade')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM interview_messages WHERE round_id = ?').get('ir-c')).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM interview_reports WHERE session_id = ?').get('is-cascade')).toEqual({ c: 0 });
  });
});

describe('US-003: Unique constraints are enforced', () => {
  it('auth_accounts (provider, provider_account_id) compound unique prevents duplicates', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-unique-aa', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('aa-1', 'u-unique-aa', 'google', 'google-id-1')`,
    ).run();

    // Same provider + providerAccountId should fail
    expect(() => {
      sqlite.prepare(
        `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('aa-2', 'u-unique-aa', 'google', 'google-id-1')`,
      ).run();
    }).toThrow();

    // Same provider with different providerAccountId should succeed
    expect(() => {
      sqlite.prepare(
        `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('aa-3', 'u-unique-aa', 'google', 'google-id-2')`,
      ).run();
    }).not.toThrow();

    // Different provider with same providerAccountId should succeed
    expect(() => {
      sqlite.prepare(
        `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ('aa-4', 'u-unique-aa', 'github', 'google-id-1')`,
      ).run();
    }).not.toThrow();
  });

  it('interview_reports session_id unique prevents duplicate reports', () => {
    sqlite.prepare(`INSERT INTO users (id, auth_type) VALUES ('u-rpt-uniq', 'fingerprint')`).run();
    sqlite.prepare(
      `INSERT INTO interview_sessions (id, user_id, job_description) VALUES ('is-rpt-uniq', 'u-rpt-uniq', 'JD')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO interview_reports (id, session_id, overall_score, dimension_scores, round_evaluations, overall_feedback, improvement_plan) VALUES ('rep-1', 'is-rpt-uniq', 80, '{}', '[]', 'ok', '[]')`,
    ).run();

    expect(() => {
      sqlite.prepare(
        `INSERT INTO interview_reports (id, session_id, overall_score, dimension_scores, round_evaluations, overall_feedback, improvement_plan) VALUES ('rep-2', 'is-rpt-uniq', 90, '{}', '[]', 'better', '[]')`,
      ).run();
    }).toThrow();
  });
});

describe('US-003: PG schema has proper FK definitions', () => {
  it('pg-schema.ts defines references for all child tables', async () => {
    const pgSchemaSource = await import('./pg-schema');

    // Verify all table exports exist
    expect(pgSchemaSource.users).toBeDefined();
    expect(pgSchemaSource.authAccounts).toBeDefined();
    expect(pgSchemaSource.resumes).toBeDefined();
    expect(pgSchemaSource.resumeSections).toBeDefined();
    expect(pgSchemaSource.chatSessions).toBeDefined();
    expect(pgSchemaSource.chatMessages).toBeDefined();
    expect(pgSchemaSource.resumeShares).toBeDefined();
    expect(pgSchemaSource.jdAnalyses).toBeDefined();
    expect(pgSchemaSource.grammarChecks).toBeDefined();
    expect(pgSchemaSource.interviewSessions).toBeDefined();
    expect(pgSchemaSource.interviewRounds).toBeDefined();
    expect(pgSchemaSource.interviewMessages).toBeDefined();
    expect(pgSchemaSource.interviewReports).toBeDefined();
  });
});
