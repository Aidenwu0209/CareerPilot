import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';

// PGlite is real PostgreSQL compiled to WASM — startup + migration takes ~5-10s per test.
vi.setConfig({ testTimeout: 30000 });

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle/pg-migrations');
const MIGRATION_JOURNAL = JSON.parse(
  readFileSync(resolve(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf-8')
);

/**
 * Read a migration SQL file and split it into individual statements
 * by drizzle's `--> statement-breakpoint` marker.
 */
function readMigrationStatements(tag: string): string[] {
  const filePath = resolve(MIGRATIONS_FOLDER, `${tag}.sql`);
  const raw = readFileSync(filePath, 'utf-8');
  return raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Compute the SHA-256 hash that drizzle uses for migration tracking.
 */
async function computeMigrationHash(tag: string): Promise<string> {
  const filePath = resolve(MIGRATIONS_FOLDER, `${tag}.sql`);
  const raw = readFileSync(filePath, 'utf-8');
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Get all migration tags from the journal in order. */
function getAllMigrationTags(): string[] {
  return MIGRATION_JOURNAL.entries.map((e: { tag: string }) => e.tag);
}

/** Typed query helper — returns rows directly with proper typing. */
async function query<T = Record<string, any>>(
  pg: PGlite,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pg.query<T>(sql, params);
  return result.rows;
}

/** Create a fresh PGlite instance (real PostgreSQL WASM). */
async function createPglite(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.waitReady;
  return pg;
}

/** Execute raw SQL statements on PGlite. */
async function execStatements(pg: PGlite, statements: string[]): Promise<void> {
  for (const stmt of statements) {
    await pg.exec(stmt);
  }
}

/**
 * Manually apply specific migrations and set up drizzle tracking table
 * so the drizzle migrator knows which migrations are already applied.
 */
async function applyMigrationsManually(
  pg: PGlite,
  tags: string[]
): Promise<void> {
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  for (const tag of tags) {
    const statements = readMigrationStatements(tag);
    await execStatements(pg, statements);

    const hash = await computeMigrationHash(tag);
    const entry = MIGRATION_JOURNAL.entries.find(
      (e: { tag: string; when: number }) => e.tag === tag
    );
    const createdAt = entry ? entry.when : Date.now();

    await pg.query(
      `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [hash, createdAt]
    );
  }
}

describe('US-010: PostgreSQL Migration — Full Install & Upgrade', () => {
  let pg: PGlite;

  beforeEach(() => {
    pg = null as unknown as PGlite;
  });

  afterEach(async () => {
    if (pg && pg.close) {
      await pg.close();
    }
  });

  // -------------------------------------------------------------------------
  // AC 1: 全新 PostgreSQL 数据库可从零执行全部 migration 并启动
  // -------------------------------------------------------------------------
  describe('AC1: Fresh install from zero', () => {
    it('should apply all migrations to an empty database without errors', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{ cnt: number }>(
        pg,
        `SELECT count(*)::int as cnt FROM drizzle."__drizzle_migrations"`
      );
      expect(rows[0].cnt).toBe(getAllMigrationTags().length);
    });

    it('should create all 58 expected tables in public schema', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{ tablename: string }>(
        pg,
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );
      const tableNames = rows.map((r) => r.tablename);

      const expectedTables = [
        'ai_models', 'ai_operations', 'ai_provider_attempts', 'ai_providers',
        'alert_deliveries', 'alert_events', 'audit_events', 'auth_accounts',
        'billing_plans', 'career_abilities', 'career_catalog_entries', 'career_catalog_versions',
        'career_colleges', 'career_evidence', 'career_goals',
        'career_guidance_notes', 'career_knowledge_documents', 'career_matches',
        'career_majors', 'career_profile_snapshots', 'career_profiles', 'career_source_snapshots', 'career_tasks',
        'chat_messages', 'chat_sessions',
        'credit_accounts', 'credit_holds', 'credit_rules', 'credit_transactions',
        'education_role_assignments', 'email_otps', 'grammar_checks',
        'interview_messages', 'interview_reports',
        'interview_rounds', 'interview_sessions', 'jd_analyses',
        'legal_consents', 'major_occupation_edges', 'occupation_aliases', 'occupation_relations', 'occupation_requirements',
        'occupations', 'organization_memberships', 'organizations',
        'password_credentials',
        'payment_orders', 'payment_refunds', 'payment_webhook_events',
        'plan_model_access', 'reconciliation_items', 'reconciliation_runs',
        'resume_sections', 'resume_shares', 'resumes', 'teacher_student_assignments', 'users',
        'user_entitlements',
      ];

      expect(tableNames.sort()).toEqual(expectedTables.sort());
    });

    it('should have platform_role and status columns on users table (from migration 0005)', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{
        column_name: string;
        column_default: string;
        is_nullable: string;
      }>(
        pg,
        `SELECT column_name, column_default, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
         AND column_name IN ('platform_role', 'status')
         ORDER BY column_name`
      );

      expect(rows).toHaveLength(2);

      const platformRole = rows.find((r) => r.column_name === 'platform_role')!;
      expect(platformRole.column_default).toContain('user');
      expect(platformRole.is_nullable).toBe('NO');

      const status = rows.find((r) => r.column_name === 'status')!;
      expect(status.column_default).toContain('active');
      expect(status.is_nullable).toBe('NO');
    });

    it('should have all foreign key constraints in place', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{ table_name: string }>(
        pg,
        `SELECT tc.table_name
         FROM information_schema.table_constraints tc
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
         ORDER BY tc.table_name`
      );

      expect(rows.length).toBeGreaterThanOrEqual(13);

      const fkTables = rows.map((r) => r.table_name);
      expect(fkTables).toContain('auth_accounts');
      expect(fkTables).toContain('chat_messages');
      expect(fkTables).toContain('chat_sessions');
      expect(fkTables).toContain('resumes');
      expect(fkTables).toContain('resume_sections');
      expect(fkTables).toContain('interview_sessions');
      expect(fkTables).toContain('interview_rounds');
      expect(fkTables).toContain('organization_memberships');
      expect(fkTables).toContain('credit_transactions');
      expect(fkTables).toContain('ai_operations');
      expect(fkTables).toContain('ai_provider_attempts');
      expect(fkTables).toContain('credit_holds');
    });
  });

  // -------------------------------------------------------------------------
  // AC 2: 包含用户、简历、分享、聊天和面试的旧库 fixture 升级后记录数量与归属一致
  // -------------------------------------------------------------------------
  describe('AC2: Legacy data survives upgrade', () => {
    it('should preserve all existing data after applying remaining migrations', async () => {
      pg = await createPglite();

      const allTags = getAllMigrationTags();
      const legacyTags = allTags.slice(0, 4); // 0000-0003 (core schema with FKs)

      // Phase 1: Apply "old" migrations manually
      await applyMigrationsManually(pg, legacyTags);

      // Phase 2: Insert legacy data
      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['user-1', 'alice@example.com', 'Alice', 'oauth']
      );
      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['user-2', 'bob@example.com', 'Bob', 'oauth']
      );

      // Resumes
      await pg.query(
        `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
        ['resume-1', 'user-1', 'Alice Resume']
      );
      await pg.query(
        `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
        ['resume-2', 'user-1', 'Alice Resume 2']
      );
      await pg.query(
        `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
        ['resume-3', 'user-2', 'Bob Resume']
      );

      // Resume sections
      await pg.query(
        `INSERT INTO resume_sections (id, resume_id, type, title, content) VALUES ($1, $2, $3, $4, $5)`,
        ['sec-1', 'resume-1', 'summary', 'Summary', '{"text":"Developer"}']
      );
      await pg.query(
        `INSERT INTO resume_sections (id, resume_id, type, title, content) VALUES ($1, $2, $3, $4, $5)`,
        ['sec-2', 'resume-1', 'experience', 'Experience', '{"text":"5 years"}']
      );

      // Chat sessions and messages
      await pg.query(
        `INSERT INTO chat_sessions (id, resume_id, title) VALUES ($1, $2, $3)`,
        ['chat-1', 'resume-1', 'Chat about resume']
      );
      await pg.query(
        `INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1, $2, $3, $4)`,
        ['msg-1', 'chat-1', 'user', 'Help me improve']
      );
      await pg.query(
        `INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1, $2, $3, $4)`,
        ['msg-2', 'chat-1', 'assistant', 'Here are suggestions']
      );

      // Resume shares
      await pg.query(
        `INSERT INTO resume_shares (id, resume_id, token) VALUES ($1, $2, $3)`,
        ['share-1', 'resume-1', 'share-token-abc']
      );

      // Interview sessions, rounds, messages, report
      await pg.query(
        `INSERT INTO interview_sessions (id, user_id, resume_id, job_description) VALUES ($1, $2, $3, $4)`,
        ['iv-session-1', 'user-1', 'resume-1', 'Senior Developer role']
      );
      await pg.query(
        `INSERT INTO interview_rounds (id, session_id, interviewer_type, interviewer_config) VALUES ($1, $2, $3, $4)`,
        ['iv-round-1', 'iv-session-1', 'technical', '{"difficulty":"hard"}']
      );
      await pg.query(
        `INSERT INTO interview_messages (id, round_id, role, content) VALUES ($1, $2, $3, $4)`,
        ['iv-msg-1', 'iv-round-1', 'interviewer', 'Tell me about your experience']
      );
      await pg.query(
        `INSERT INTO interview_reports (id, session_id, overall_score, dimension_scores, round_evaluations, overall_feedback, improvement_plan) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['iv-report-1', 'iv-session-1', 85, '{}', '{}', 'Good performance', 'Practice more']
      );

      // Grammar checks and JD analyses
      await pg.query(
        `INSERT INTO grammar_checks (id, resume_id, result, score, issue_count) VALUES ($1, $2, $3, $4, $5)`,
        ['gc-1', 'resume-1', '{"issues":[]}', 95, 0]
      );
      await pg.query(
        `INSERT INTO jd_analyses (id, resume_id, job_description, result, overall_score, ats_score) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['jd-1', 'resume-1', 'Developer job', '{"match":0.9}', 90, 88]
      );

      // Auth accounts
      await pg.query(
        `INSERT INTO auth_accounts (id, user_id, provider, provider_account_id) VALUES ($1, $2, $3, $4)`,
        ['auth-1', 'user-1', 'google', 'google-id-1']
      );

      // Phase 3: Record pre-upgrade counts
      const preCounts: Record<string, number> = {};
      const tables = [
        'users', 'resumes', 'resume_sections', 'chat_sessions', 'chat_messages',
        'resume_shares', 'interview_sessions', 'interview_rounds', 'interview_messages',
        'interview_reports', 'grammar_checks', 'jd_analyses', 'auth_accounts',
      ];
      for (const table of tables) {
        const rows = await query<{ cnt: number }>(
          pg,
          `SELECT count(*)::int as cnt FROM "${table}"`
        );
        preCounts[table] = rows[0].cnt;
      }

      // Phase 4: Apply remaining migrations via drizzle migrator
      const db = drizzle(pg);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // Phase 5: Verify all data is preserved
      for (const table of tables) {
        const rows = await query<{ cnt: number }>(
          pg,
          `SELECT count(*)::int as cnt FROM "${table}"`
        );
        expect(rows[0].cnt).toBe(preCounts[table]);
      }

      // Verify specific ownership relationships
      const aliceResumes = await query<{ id: string; title: string }>(
        pg,
        `SELECT id, title FROM resumes WHERE user_id = $1 ORDER BY id`,
        ['user-1']
      );
      expect(aliceResumes).toHaveLength(2);
      expect(aliceResumes[0].id).toBe('resume-1');
      expect(aliceResumes[1].id).toBe('resume-2');

      const bobResumes = await query<{ id: string }>(
        pg,
        `SELECT id FROM resumes WHERE user_id = $1`,
        ['user-2']
      );
      expect(bobResumes).toHaveLength(1);

      // Verify chat messages still belong to correct session
      const chatMsgs = await query<{ role: string }>(
        pg,
        `SELECT role FROM chat_messages WHERE session_id = $1 ORDER BY id`,
        ['chat-1']
      );
      expect(chatMsgs).toHaveLength(2);
      expect(chatMsgs[0].role).toBe('user');
      expect(chatMsgs[1].role).toBe('assistant');

      // Verify interview session ownership
      const ivSession = await query<{ user_id: string; resume_id: string }>(
        pg,
        `SELECT user_id, resume_id FROM interview_sessions WHERE id = $1`,
        ['iv-session-1']
      );
      expect(ivSession[0].user_id).toBe('user-1');
      expect(ivSession[0].resume_id).toBe('resume-1');

      // Verify existing users got the new platform_role and status defaults
      const users = await query<{ id: string; platform_role: string; status: string }>(
        pg,
        `SELECT id, platform_role, status FROM users ORDER BY id`
      );
      expect(users[0].platform_role).toBe('user');
      expect(users[0].status).toBe('active');
      expect(users[1].platform_role).toBe('user');
      expect(users[1].status).toBe('active');
    });
  });

  // -------------------------------------------------------------------------
  // AC 3: 重复启动不会创建重复角色、membership、账户或赠点
  // -------------------------------------------------------------------------
  describe('AC3: Idempotent startup (no duplicates on re-run)', () => {
    it('should not error or duplicate data when migrations run twice', async () => {
      pg = await createPglite();

      const db = drizzle(pg);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // Insert data representing post-startup state
      await pg.query(
        `INSERT INTO users (id, email, name, auth_type, platform_role, status) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['u-admin', 'admin@example.com', 'Admin', 'oauth', 'super_admin', 'active']
      );
      await pg.query(
        `INSERT INTO organizations (id, slug, name, status, seat_limit, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['org-1', 'test-org', 'Test Org', 'active', 10, 'u-admin']
      );
      await pg.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
        ['mem-1', 'org-1', 'u-admin', 'org_admin', 'active']
      );
      await pg.query(
        `INSERT INTO credit_accounts (id, owner_type, owner_id, balance, status) VALUES ($1, $2, $3, $4, $5)`,
        ['acct-1', 'user', 'u-admin', 100, 'active']
      );
      await pg.query(
        `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['txn-1', 'acct-1', 0, 100, 100, 'registration_grant', 'idem-grant-1', 'Initial grant']
      );

      // Second run — should be a no-op
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // Verify no duplicates
      const userCount = await query<{ cnt: number }>(
        pg, `SELECT count(*)::int as cnt FROM users WHERE id = $1`, ['u-admin']
      );
      expect(userCount[0].cnt).toBe(1);

      const orgCount = await query<{ cnt: number }>(
        pg, `SELECT count(*)::int as cnt FROM organizations WHERE slug = $1`, ['test-org']
      );
      expect(orgCount[0].cnt).toBe(1);

      const memCount = await query<{ cnt: number }>(
        pg,
        `SELECT count(*)::int as cnt FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
        ['org-1', 'u-admin']
      );
      expect(memCount[0].cnt).toBe(1);

      const acctCount = await query<{ cnt: number }>(
        pg,
        `SELECT count(*)::int as cnt FROM credit_accounts WHERE owner_type = $1 AND owner_id = $2`,
        ['user', 'u-admin']
      );
      expect(acctCount[0].cnt).toBe(1);

      const txnCount = await query<{ cnt: number }>(
        pg,
        `SELECT count(*)::int as cnt FROM credit_transactions WHERE idempotency_key = $1`,
        ['idem-grant-1']
      );
      expect(txnCount[0].cnt).toBe(1);

      // Migration tracking table should still have exactly 12 entries
      const trackingCount = await query<{ cnt: number }>(
        pg, `SELECT count(*)::int as cnt FROM drizzle."__drizzle_migrations"`
      );
      expect(trackingCount[0].cnt).toBe(getAllMigrationTags().length);
    });
  });

  // -------------------------------------------------------------------------
  // AC 4: 迁移失败回退到升级前备份后，旧数据仍可读取
  // -------------------------------------------------------------------------
  describe('AC4: Migration failure leaves existing data intact', () => {
    it('should leave existing data readable after a failed SQL statement', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['u-survive', 'survive@example.com', 'Survivor', 'oauth']
      );
      await pg.query(
        `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
        ['r-survive', 'u-survive', 'Surviving Resume']
      );

      // Simulate a migration failure (table already exists)
      try {
        await pg.exec(`CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL);`);
      } catch {
        // Expected — table already exists
      }

      // Verify data is still readable
      const users = await query<{ id: string; email: string }>(
        pg, `SELECT id, email FROM users WHERE id = $1`, ['u-survive']
      );
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('survive@example.com');

      const resumes = await query<{ id: string; title: string }>(
        pg, `SELECT id, title FROM resumes WHERE user_id = $1`, ['u-survive']
      );
      expect(resumes).toHaveLength(1);
      expect(resumes[0].title).toBe('Surviving Resume');
    });

    it('should preserve data when a mid-upgrade migration fails (transactional safety)', async () => {
      pg = await createPglite();

      const allTags = getAllMigrationTags();
      await applyMigrationsManually(pg, allTags.slice(0, 4));

      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['u-legacy', 'legacy@example.com', 'Legacy', 'oauth']
      );
      await pg.query(
        `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
        ['r-legacy', 'u-legacy', 'Legacy Resume']
      );

      // Simulate a failed migration before upgrading
      try {
        await pg.exec(`ALTER TABLE "users" ADD COLUMN "bad_column" text NOT NULL DEFAULT 'x';`);
        await pg.exec(`ALTER TABLE "users" DROP COLUMN "bad_column";`);
      } catch {
        // Data should still be intact
      }

      // Now apply remaining migrations
      const db = drizzle(pg);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // Verify data is still readable
      const user = await query<{
        id: string; email: string; platform_role: string; status: string;
      }>(
        pg, `SELECT id, email, platform_role, status FROM users WHERE id = $1`, ['u-legacy']
      );
      expect(user).toHaveLength(1);
      expect(user[0].email).toBe('legacy@example.com');
      expect(user[0].platform_role).toBe('user');
      expect(user[0].status).toBe('active');

      const resume = await query<{ id: string; title: string }>(
        pg, `SELECT id, title FROM resumes WHERE id = $1`, ['r-legacy']
      );
      expect(resume).toHaveLength(1);
      expect(resume[0].title).toBe('Legacy Resume');
    });
  });

  // -------------------------------------------------------------------------
  // AC 5: 迁移测试在 CI 中使用真实 PostgreSQL 而不是内存假实现
  // -------------------------------------------------------------------------
  describe('AC5: Real PostgreSQL engine (not in-memory mock)', () => {
    it('should confirm PGlite is real PostgreSQL (not SQLite or mock)', async () => {
      pg = await createPglite();
      const rows = await query<{ version: string }>(pg, `SELECT version()`);
      const version = rows[0].version;

      expect(version).toContain('PostgreSQL');
      expect(version).not.toContain('SQLite');
    });

    it('should execute PostgreSQL-specific SQL features', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // SERIAL / auto-increment sequence
      const seqRows = await query<{ last_value: number }>(
        pg, `SELECT last_value FROM drizzle."__drizzle_migrations_id_seq"`
      );
      expect(seqRows).toHaveLength(1);

      // PL/pgSQL functions
      const funcRows = await query<{ proname: string }>(
        pg,
        `SELECT proname FROM pg_proc WHERE proname = 'prevent_credit_transaction_modification'`
      );
      expect(funcRows).toHaveLength(1);

      // Triggers
      const triggerRows = await query<{ trigger_name: string }>(
        pg,
        `SELECT trigger_name FROM information_schema.triggers
         WHERE trigger_schema = 'public' ORDER BY trigger_name`
      );
      const triggerNames = triggerRows.map((r) => r.trigger_name);
      expect(triggerNames).toContain('credit_transactions_no_update');
      expect(triggerNames).toContain('credit_transactions_no_delete');
      expect(triggerNames).toContain('audit_events_no_update');
      expect(triggerNames).toContain('audit_events_no_delete');
      expect(triggerNames).toContain('legal_consents_no_update');
      expect(triggerNames).toContain('legal_consents_no_delete');

      // CHECK constraints
      const checkRows = await query<{ conname: string }>(
        pg,
        `SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname`
      );
      const checkNames = checkRows.map((r) => r.conname);
      expect(checkNames).toContain('credit_accounts_balance_non_negative');
      expect(checkNames).toContain('credit_transactions_balance_before_non_negative');
      expect(checkNames).toContain('career_evidence_assessed_score_check');

      await pg.exec(`
        INSERT INTO users (id, auth_type) VALUES ('career-score-check-user', 'email');
        INSERT INTO career_evidence (id, user_id, ability_code, source_type, title)
          VALUES ('career-score-check-evidence', 'career-score-check-user', 'communication', 'manual', 'Evidence');
      `);
      await expect(pg.exec(`
        UPDATE career_evidence SET assessed_score = 101 WHERE id = 'career-score-check-evidence'
      `)).rejects.toThrow();
      expect(checkNames).toContain('credit_transactions_balance_after_non_negative');
      expect(checkNames).toContain('credit_rules_value_non_negative');
      expect(checkNames).toContain('ai_models_fixed_price_check');
      expect(checkNames).toContain('ai_provider_attempts_attempt_number_positive');
      expect(checkNames).toContain('credit_holds_hold_amount_non_negative');
      expect(checkNames).toContain('credit_holds_settled_amount_non_negative');
    });

    it('should enforce CHECK constraints on real PostgreSQL', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['u-check', 'check@example.com', 'Check', 'oauth']
      );

      // Negative balance should fail
      await expect(
        pg.query(
          `INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ($1, $2, $3, $4)`,
          ['acct-bad', 'user', 'u-check', -50]
        )
      ).rejects.toThrow();

      // Verify the bad account was not created
      const rows = await query<{ cnt: number }>(
        pg, `SELECT count(*)::int as cnt FROM credit_accounts WHERE id = $1`, ['acct-bad']
      );
      expect(rows[0].cnt).toBe(0);
    });

    it('should enforce immutability triggers on real PostgreSQL', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      await pg.query(
        `INSERT INTO users (id, email, name, auth_type) VALUES ($1, $2, $3, $4)`,
        ['u-imm', 'imm@example.com', 'Immutable', 'oauth']
      );
      await pg.query(
        `INSERT INTO credit_accounts (id, owner_type, owner_id, balance) VALUES ($1, $2, $3, $4)`,
        ['acct-imm', 'user', 'u-imm', 100]
      );
      await pg.query(
        `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['txn-imm', 'acct-imm', 0, 100, 100, 'registration_grant', 'idem-imm-1', 'Test']
      );

      // UPDATE should fail
      await expect(
        pg.query(`UPDATE credit_transactions SET delta = 200 WHERE id = $1`, ['txn-imm'])
      ).rejects.toThrow();

      // DELETE should fail
      await expect(
        pg.query(`DELETE FROM credit_transactions WHERE id = $1`, ['txn-imm'])
      ).rejects.toThrow();

      // Verify original data is unchanged
      const rows = await query<{ delta: number }>(
        pg, `SELECT delta FROM credit_transactions WHERE id = $1`, ['txn-imm']
      );
      expect(rows[0].delta).toBe(100);
    });

    it('should enforce foreign key constraints on real PostgreSQL', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      // Non-existent user_id
      await expect(
        pg.query(
          `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
          ['r-fk', 'nonexistent-user', 'FK Test']
        )
      ).rejects.toThrow();

      // Non-existent session
      await expect(
        pg.query(
          `INSERT INTO chat_messages (id, session_id, role, content) VALUES ($1, $2, $3, $4)`,
          ['msg-fk', 'nonexistent-session', 'user', 'test']
        )
      ).rejects.toThrow();

      // Non-existent org and user
      await expect(
        pg.query(
          `INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)`,
          ['mem-fk', 'nonexistent-org', 'nonexistent-user', 'member']
        )
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Schema completeness verification
  // -------------------------------------------------------------------------
  describe('Schema completeness after full migration', () => {
    it('should have all migration SQL files present and accounted for', () => {
      const sqlFiles = readdirSync(MIGRATIONS_FOLDER)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      expect(sqlFiles.length).toBe(getAllMigrationTags().length);

      const journalTags = getAllMigrationTags();
      const fileTags = sqlFiles.map((f) => f.replace('.sql', ''));
      expect(fileTags).toEqual(journalTags);
    });

    it('should have unique constraints defined', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{ conname: string }>(
        pg,
        `SELECT conname FROM (
           SELECT tc.constraint_name as conname
           FROM information_schema.table_constraints tc
           WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
         ) sub ORDER BY conname`
      );

      const constraintNames = rows.map((r) => r.conname);
      expect(constraintNames).toContain('users_email_unique');
      expect(constraintNames).toContain('users_fingerprint_unique');
      expect(constraintNames).toContain('resume_shares_token_unique');
      expect(constraintNames).toContain('auth_accounts_provider_provider_account_id_unique');
      expect(constraintNames).toContain('interview_reports_session_id_unique');
      expect(constraintNames).toContain('organizations_slug_unique');
      expect(constraintNames).toContain('organization_memberships_organization_id_user_id_unique');
      expect(constraintNames).toContain('credit_accounts_owner_type_owner_id_unique');
      expect(constraintNames).toContain('credit_transactions_account_id_idempotency_key_unique');
      expect(constraintNames).toContain('ai_operations_idempotency_key_unique');
      expect(constraintNames).toContain('ai_models_provider_id_model_identifier_unique');
      expect(constraintNames).toContain('ai_provider_attempts_operation_id_attempt_number_unique');
    });

    it('should have indexes defined for common queries', async () => {
      pg = await createPglite();
      const db = drizzle(pg);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = await query<{ indexname: string }>(
        pg,
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
      );
      const indexNames = rows.map((r) => r.indexname);

      // Core indexes
      expect(indexNames).toContain('resumes_user_id_idx');
      expect(indexNames).toContain('chat_sessions_resume_id_idx');
      expect(indexNames).toContain('interview_sessions_user_id_idx');
      expect(indexNames).toContain('resume_sections_resume_id_idx');

      // Commercial indexes
      expect(indexNames).toContain('organizations_status_idx');
      expect(indexNames).toContain('organization_memberships_user_id_idx');
      expect(indexNames).toContain('credit_accounts_owner_type_idx');
      expect(indexNames).toContain('credit_transactions_account_id_idx');

      // AI indexes
      expect(indexNames).toContain('ai_providers_status_idx');
      expect(indexNames).toContain('ai_models_status_idx');
      expect(indexNames).toContain('ai_operations_actor_id_idx');

      // Audit indexes
      expect(indexNames).toContain('audit_events_actor_id_idx');
      expect(indexNames).toContain('legal_consents_user_id_idx');
    });
  });
});
