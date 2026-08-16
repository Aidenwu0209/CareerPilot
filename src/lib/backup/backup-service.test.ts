import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { resolve } from 'path';

/**
 * US-084 tests: PostgreSQL Backup and Restore Verification.
 *
 * Validates:
 * - AC1: Backup task generates encrypted PostgreSQL backup with minimal-privilege credentials
 * - AC2: Backup target is isolated; retention and owner are configurable
 * - AC3: Isolated restore environment can restore users, resumes, orgs, balances, transactions, AI usage
 * - AC4: After restore, balance recompute diff is zero, FK relationships check passes
 * - AC5: Restore drill records actual RPO/RTO; backup failure notifies responsible owner
 *
 * Uses PGlite (real PostgreSQL WASM) for source and target databases.
 */

// PGlite startup/migrations also happen in hooks and can exceed Vitest's
// 10-second hook default when PostgreSQL integration files run in parallel.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle/pg-migrations');
const TEST_ENCRYPTION_KEY = 'a-very-strong-backup-encryption-key-32+chars!';

// --- PGlite queryable adapter ---

import type { BackupQueryable } from './types';
import { validateBackupConfig, parseBackupConfig } from './types';
import {
  createBackup,
  encryptData,
  decryptData,
  decryptBackup,
  verifyBackupIntegrity,
} from './backup-service';
import {
  restoreFromBackup,
  verifyBalanceIntegrity,
  recordDrill,
} from './restore-service';

function pgliteQueryable(pg: PGlite): BackupQueryable {
  return {
    query: async (sql, params) => {
      const result = await pg.query(sql, params as unknown[]);
      return result.rows as Record<string, unknown>[];
    },
    exec: async (sql) => {
      await pg.exec(sql);
    },
  };
}

// --- Helpers ---

async function createPglite(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.waitReady;
  return pg;
}

async function migrateDb(pg: PGlite): Promise<void> {
  const db = drizzle(pg);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Seed a source database with representative commercial data. */
async function seedCommercialData(pg: PGlite): Promise<void> {
  // User
  await pg.query(
    `INSERT INTO users (id, email, name, auth_type, platform_role, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['u-backup-1', 'backup@test.com', 'Backup Test', 'oauth', 'user', 'active'],
  );

  // Resume
  await pg.query(
    `INSERT INTO resumes (id, user_id, title) VALUES ($1, $2, $3)`,
    ['r-backup-1', 'u-backup-1', 'My Resume'],
  );
  await pg.query(
    `INSERT INTO resume_sections (id, resume_id, type, title, content)
     VALUES ($1, $2, $3, $4, $5)`,
    ['rs-1', 'r-backup-1', 'summary', 'Summary', '{"text":"Developer"}'],
  );

  // Organization
  await pg.query(
    `INSERT INTO organizations (id, slug, name, status, seat_limit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['org-backup-1', 'backup-org', 'Backup Org', 'active', 10, 'u-backup-1'],
  );
  await pg.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $3, $4, $5)`,
    ['mem-1', 'org-backup-1', 'u-backup-1', 'org_admin', 'active'],
  );

  // Credit account + transactions (balance should match ledger)
  await pg.query(
    `INSERT INTO credit_accounts (id, owner_type, owner_id, balance, status)
     VALUES ($1, $2, $3, $4, $5)`,
    ['acct-backup-1', 'user', 'u-backup-1', 150, 'active'],
  );
  // Balance: 0 + 100 + 50 - 0 = 150 (matches stored balance)
  await pg.query(
    `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['txn-backup-1', 'acct-backup-1', 0, 100, 100, 'registration_grant', 'idem-backup-1', 'Registration grant'],
  );
  await pg.query(
    `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['txn-backup-2', 'acct-backup-1', 100, 50, 150, 'manual_credit', 'idem-backup-2', 'Manual adjustment'],
  );

  // Org credit account
  await pg.query(
    `INSERT INTO credit_accounts (id, owner_type, owner_id, balance, status)
     VALUES ($1, $2, $3, $4, $5)`,
    ['acct-org-1', 'organization', 'org-backup-1', 500, 'active'],
  );
  await pg.query(
    `INSERT INTO credit_transactions (id, account_id, balance_before, delta, balance_after, reason, idempotency_key, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    ['txn-org-1', 'acct-org-1', 0, 500, 500, 'org_initial_grant', 'idem-org-1', 'Org initial balance'],
  );

  // AI provider + model
  await pg.query(
    `INSERT INTO ai_providers (id, type, name, status)
     VALUES ($1, $2, $3, $4)`,
    ['prov-1', 'openai', 'OpenAI Prod', 'active'],
  );
  await pg.query(
    `INSERT INTO ai_models (id, provider_id, model_identifier, display_name, status, tier)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['model-1', 'prov-1', 'gpt-4o', 'GPT-4o', 'active', 'standard'],
  );

  // AI operation + attempt
  await pg.query(
    `INSERT INTO ai_operations (id, actor_id, billing_account_id, capability, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['op-1', 'u-backup-1', 'acct-backup-1', 'resume_optimize', 'completed', 'idem-op-1'],
  );
  await pg.query(
    `INSERT INTO ai_provider_attempts (id, operation_id, model_id, attempt_number, status, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['attempt-1', 'op-1', 'model-1', 1, 'success', 1234],
  );

  // Credit hold (settled)
  await pg.query(
    `INSERT INTO credit_holds (id, account_id, operation_id, hold_amount, settled_amount, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['hold-1', 'acct-backup-1', 'op-1', 10, 10, 'settled'],
  );

  // Audit event
  await pg.query(
    `INSERT INTO audit_events (id, actor_id, action, target_type, target_id, summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['audit-1', 'u-backup-1', 'ai_operation', 'ai_operation', 'op-1', 'AI optimize completed'],
  );

  // Legal consent
  await pg.query(
    `INSERT INTO legal_consents (id, user_id, document_type, version, effective_date, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['consent-1', 'u-backup-1', 'terms', '2026.1', Math.floor(Date.now() / 1000), 'web'],
  );
}

// ===========================================================================
// AC1: Backup generates encrypted PostgreSQL backup with minimal-privilege
// ===========================================================================

describe('AC1: Encrypted backup creation', () => {
  let pg: PGlite;

  beforeEach(async () => {
    pg = await createPglite();
    await migrateDb(pg);
    await seedCommercialData(pg);
  });

  afterEach(async () => {
    if (pg?.close) await pg.close();
  });

  it('creates an encrypted backup containing all table data', async () => {
    const source = pgliteQueryable(pg);
    const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    expect(result.ok).toBe(true);
    expect(result.backup).toBeDefined();

    const backup = result.backup!;
    expect(backup.metadata.format).toBe('careerpilot-backup');
    expect(backup.metadata.version).toBe(1);
    expect(backup.metadata.tableCount).toBeGreaterThan(0);
    expect(backup.metadata.totalRows).toBeGreaterThan(0);
    expect(backup.metadata.createdAt).toBeGreaterThan(0);
    expect(backup.metadata.rpoTimestamp).toBeGreaterThan(0);
    expect(backup.metadata.encryptedSize).toBeGreaterThan(0);
    expect(backup.metadata.checksum).toHaveLength(64); // SHA-256 hex
  });

  it('backup data is encrypted and cannot be read without the key', async () => {
    const source = pgliteQueryable(pg);
    const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    expect(result.ok).toBe(true);
    const backup = result.backup!;

    // Raw encrypted data should not contain plaintext table data
    const dataStr = backup.data;
    expect(dataStr).not.toContain('backup@test.com');
    expect(dataStr).not.toContain('u-backup-1');
    expect(dataStr).not.toContain('My Resume');

    // Decryption with wrong key should fail
    expect(() => {
      decryptBackup(backup, 'wrong-encryption-key-that-is-long-enough!');
    }).toThrow();
  });

  it('backup contains users, resumes, organizations, balances, transactions, AI usage', async () => {
    const source = pgliteQueryable(pg);
    const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    expect(result.ok).toBe(true);
    const payload = decryptBackup(result.backup!, TEST_ENCRYPTION_KEY);

    expect(payload.tables.users.length).toBe(1);
    expect(payload.tables.resumes.length).toBe(1);
    expect(payload.tables.organizations.length).toBe(1);
    expect(payload.tables.credit_accounts.length).toBe(2);
    expect(payload.tables.credit_transactions.length).toBe(3);
    expect(payload.tables.ai_operations.length).toBe(1);
    expect(payload.tables.ai_provider_attempts.length).toBe(1);
  });

  it('backup does not contain application secrets or connection strings', async () => {
    // Set env vars that should NEVER appear in backup data
    process.env.AUTH_SECRET = 'super-secret-auth-value-1234567890';
    process.env.AI_CREDENTIAL_MASTER_KEY = 'super-secret-ai-key-1234567890';
    process.env.DATABASE_URL = 'postgresql://admin:password@db.internal:5432/prod';

    try {
      const source = pgliteQueryable(pg);
      const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

      expect(result.ok).toBe(true);
      const payload = decryptBackup(result.backup!, TEST_ENCRYPTION_KEY);
      const payloadStr = JSON.stringify(payload);

      expect(payloadStr).not.toContain('super-secret-auth-value');
      expect(payloadStr).not.toContain('super-secret-ai-key');
      expect(payloadStr).not.toContain('postgresql://admin:password');
      expect(payloadStr).not.toContain('db.internal');
    } finally {
      delete process.env.AUTH_SECRET;
      delete process.env.AI_CREDENTIAL_MASTER_KEY;
      delete process.env.DATABASE_URL;
    }
  });
});

// ===========================================================================
// AC2: Configurable retention, owner, and isolation
// ===========================================================================

describe('AC2: Backup configuration validation', () => {
  it('validates required fields when backups are enabled in production', () => {
    const result = validateBackupConfig({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      // Missing: BACKUP_DESTINATION, BACKUP_RETENTION_DAYS, BACKUP_OWNER_EMAIL, BACKUP_ENCRYPTION_KEY
    });

    expect(result.ok).toBe(false);
    const fields = result.issues.map((i) => i.field);
    expect(fields).toContain('BACKUP_DESTINATION');
    expect(fields).toContain('BACKUP_RETENTION_DAYS');
    expect(fields).toContain('BACKUP_OWNER_EMAIL');
    expect(fields).toContain('BACKUP_ENCRYPTION_KEY');
  });

  it('passes when all required fields are present and valid', () => {
    const result = validateBackupConfig({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      BACKUP_DESTINATION: '/mnt/backup-volume',
      BACKUP_RETENTION_DAYS: '7',
      BACKUP_OWNER_EMAIL: 'ops@example.com',
      BACKUP_ENCRYPTION_KEY: 'a-strong-unique-key-that-is-32-chars!',
      AUTH_SECRET: 'different-auth-secret',
      AI_CREDENTIAL_MASTER_KEY: 'different-ai-key',
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects encryption key shorter than 32 characters', () => {
    const result = validateBackupConfig({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      BACKUP_DESTINATION: '/mnt/backups',
      BACKUP_RETENTION_DAYS: '7',
      BACKUP_OWNER_EMAIL: 'ops@example.com',
      BACKUP_ENCRYPTION_KEY: 'short-key',
    });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.field === 'BACKUP_ENCRYPTION_KEY');
    expect(issue?.message).toContain('32 characters');
  });

  it('rejects encryption key that matches AUTH_SECRET or AI_CREDENTIAL_MASTER_KEY', () => {
    const sharedKey = 'shared-key-that-is-long-enough-1234567890';
    const result = validateBackupConfig({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      BACKUP_DESTINATION: '/mnt/backups',
      BACKUP_RETENTION_DAYS: '7',
      BACKUP_OWNER_EMAIL: 'ops@example.com',
      BACKUP_ENCRYPTION_KEY: sharedKey,
      AUTH_SECRET: sharedKey,
      AI_CREDENTIAL_MASTER_KEY: 'different-key-1234567890',
    });

    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.field === 'BACKUP_ENCRYPTION_KEY');
    expect(issue?.message).toContain('different from AUTH_SECRET');
  });

  it('rejects invalid owner email', () => {
    const result = validateBackupConfig({
      NODE_ENV: 'production',
      BACKUP_ENABLED: 'true',
      BACKUP_DESTINATION: '/mnt/backups',
      BACKUP_RETENTION_DAYS: '7',
      BACKUP_OWNER_EMAIL: 'not-an-email',
      BACKUP_ENCRYPTION_KEY: 'a-strong-unique-key-that-is-32-chars!',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.field === 'BACKUP_OWNER_EMAIL')).toBeDefined();
  });

  it('parseBackupConfig returns null when disabled', () => {
    const config = parseBackupConfig({ BACKUP_ENABLED: 'false' });
    expect(config).toBeNull();
  });

  it('parseBackupConfig returns config when enabled', () => {
    const config = parseBackupConfig({
      BACKUP_ENABLED: 'true',
      BACKUP_DESTINATION: '/mnt/backups',
      BACKUP_RETENTION_DAYS: '14',
      BACKUP_OWNER_EMAIL: 'ops@example.com',
      BACKUP_ENCRYPTION_KEY: 'a-strong-key-32-chars-minimum!!',
    });

    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(true);
    expect(config!.destination).toBe('/mnt/backups');
    expect(config!.retentionDays).toBe(14);
    expect(config!.ownerEmail).toBe('ops@example.com');
    expect(config!.schedule).toBe('daily');
  });
});

// ===========================================================================
// AC3: Isolated restore environment can restore from latest backup
// ===========================================================================

describe('AC3: Full restore into isolated environment', () => {
  let sourcePg: PGlite;
  let targetPg: PGlite;

  beforeEach(async () => {
    sourcePg = await createPglite();
    await migrateDb(sourcePg);
    await seedCommercialData(sourcePg);

    targetPg = await createPglite();
    await migrateDb(targetPg); // Schema exists but empty
  });

  afterEach(async () => {
    if (sourcePg?.close) await sourcePg.close();
    if (targetPg?.close) await targetPg.close();
  });

  it('restores all data from backup into a fresh isolated database', async () => {
    // Create backup from source
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');
    expect(backupResult.ok).toBe(true);

    // Restore into target
    const target = pgliteQueryable(targetPg);
    const restoreResult = await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.error).toBeUndefined();

    // Verify specific data is present
    const users = await targetPg.query<{ id: string; email: string }>(`SELECT id, email FROM users`);
    expect(users.rows.length).toBe(1);
    expect(users.rows[0].email).toBe('backup@test.com');

    const resumes = await targetPg.query<{ id: string; title: string }>(`SELECT id, title FROM resumes`);
    expect(resumes.rows.length).toBe(1);
    expect(resumes.rows[0].title).toBe('My Resume');

    const orgs = await targetPg.query<{ id: string; slug: string }>(`SELECT id, slug FROM organizations`);
    expect(orgs.rows.length).toBe(1);
    expect(orgs.rows[0].slug).toBe('backup-org');

    const accounts = await targetPg.query<{ id: string; balance: number }>(`SELECT id, balance FROM credit_accounts ORDER BY id`);
    expect(accounts.rows.length).toBe(2);
    expect(accounts.rows[0].balance).toBe(150);
    expect(accounts.rows[1].balance).toBe(500);
  });

  it('restore includes AI operations and provider attempts', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    const ops = await targetPg.query<{ id: string; capability: string; status: string }>(`SELECT id, capability, status FROM ai_operations`);
    expect(ops.rows.length).toBe(1);
    expect(ops.rows[0].capability).toBe('resume_optimize');

    const attempts = await targetPg.query<{ id: string; status: string }>(`SELECT id, status FROM ai_provider_attempts`);
    expect(attempts.rows.length).toBe(1);
    expect(attempts.rows[0].status).toBe('success');
  });

  it('restore includes credit holds and audit events', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    const holds = await targetPg.query<{ id: string; hold_amount: number; status: string }>(`SELECT id, hold_amount, status FROM credit_holds`);
    expect(holds.rows.length).toBe(1);
    expect(holds.rows[0].status).toBe('settled');

    const audits = await targetPg.query<{ id: string; action: string }>(`SELECT id, action FROM audit_events`);
    expect(audits.rows.length).toBe(1);
    expect(audits.rows[0].action).toBe('ai_operation');
  });

  it('restore fails gracefully with wrong encryption key', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    const result = await restoreFromBackup(
      target,
      backupResult.backup!,
      'wrong-encryption-key-that-is-long-enough!',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Decryption failed');
  });
});

// ===========================================================================
// AC4: Balance recompute diff is zero, FK relationships check passes
// ===========================================================================

describe('AC4: Post-restore integrity verification', () => {
  let sourcePg: PGlite;
  let targetPg: PGlite;

  beforeEach(async () => {
    sourcePg = await createPglite();
    await migrateDb(sourcePg);
    await seedCommercialData(sourcePg);

    targetPg = await createPglite();
    await migrateDb(targetPg);
  });

  afterEach(async () => {
    if (sourcePg?.close) await sourcePg.close();
    if (targetPg?.close) await targetPg.close();
  });

  it('balance recompute diff is zero for all credit accounts', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    const restoreResult = await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.verification!.balanceCheck.ok).toBe(true);
    expect(restoreResult.verification!.balanceCheck.accountsChecked).toBe(2);
    expect(restoreResult.verification!.balanceCheck.mismatches).toHaveLength(0);
  });

  it('balance integrity check detects mismatches', async () => {
    // Restore first
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');
    const target = pgliteQueryable(targetPg);
    await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    // Corrupt a balance to create a mismatch
    await targetPg.query(
      `UPDATE credit_accounts SET balance = 999 WHERE id = $1`,
      ['acct-backup-1'] as unknown[],
    );

    const result = await verifyBalanceIntegrity(target);
    expect(result.ok).toBe(false);
    expect(result.mismatches.length).toBeGreaterThanOrEqual(1);

    const mismatch = result.mismatches.find((m) => m.accountId === 'acct-backup-1');
    expect(mismatch).toBeDefined();
    expect(mismatch!.storedBalance).toBe(999);
    expect(mismatch!.computedBalance).toBe(150);
    expect(mismatch!.diff).toBe(849);
  });

  it('foreign key integrity check passes after clean restore', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    const restoreResult = await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    expect(restoreResult.ok).toBe(true);
    const fkCheck = restoreResult.verification!.foreignKeyCheck;
    expect(fkCheck.ok).toBe(true);
    expect(fkCheck.totalConstraints).toBeGreaterThanOrEqual(13);
    expect(fkCheck.violations).toHaveLength(0);
  });

  it('row count check matches source and restored databases', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    const restoreResult = await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    expect(restoreResult.ok).toBe(true);
    const rowCountCheck = restoreResult.verification!.rowCountCheck;
    expect(rowCountCheck.ok).toBe(true);

    // Check specific tables
    const usersRow = rowCountCheck.tables.find((t) => t.table === 'users');
    expect(usersRow?.sourceCount).toBe(1);
    expect(usersRow?.restoredCount).toBe(1);
    expect(usersRow?.match).toBe(true);

    const txnRow = rowCountCheck.tables.find((t) => t.table === 'credit_transactions');
    expect(txnRow?.sourceCount).toBe(3);
    expect(txnRow?.restoredCount).toBe(3);
  });
});

// ===========================================================================
// AC5: Restore drill records RPO/RTO; failure notifies owner
// ===========================================================================

describe('AC5: RPO/RTO recording and failure notification', () => {
  let sourcePg: PGlite;
  let targetPg: PGlite;

  beforeEach(async () => {
    sourcePg = await createPglite();
    await migrateDb(sourcePg);
    await seedCommercialData(sourcePg);

    targetPg = await createPglite();
    await migrateDb(targetPg);
  });

  afterEach(async () => {
    if (sourcePg?.close) await sourcePg.close();
    if (targetPg?.close) await targetPg.close();
  });

  it('restore records actual RPO and RTO metrics', async () => {
    const source = pgliteQueryable(sourcePg);
    const backupResult = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

    const target = pgliteQueryable(targetPg);
    const restoreResult = await restoreFromBackup(target, backupResult.backup!, TEST_ENCRYPTION_KEY);

    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.rtoSeconds).toBeGreaterThan(0);
    expect(restoreResult.rtoSeconds).toBeLessThan(60); // Should complete quickly for small data
    expect(restoreResult.rpoTimestamp).toBe(backupResult.backup!.metadata.rpoTimestamp);
    expect(restoreResult.effectiveRpoSeconds).toBeGreaterThanOrEqual(0);
  });

  it('recordDrill produces a drill record with RPO/RTO', () => {
    const backupCreatedAt = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const drill = recordDrill(
      backupCreatedAt,
      120, // RTO: 2 minutes
      true,
      'ops@example.com',
    );

    expect(drill.backupCreatedAt).toBe(backupCreatedAt);
    expect(drill.rtoSeconds).toBe(120);
    expect(drill.rpoSeconds).toBeGreaterThanOrEqual(3600);
    expect(drill.verificationPassed).toBe(true);
    expect(drill.performedBy).toBe('ops@example.com');
    expect(drill.restoredAt).toBeGreaterThan(backupCreatedAt);
  });

  it('backup failure result includes owner email for notification', async () => {
    // Use a broken queryable that simulates a connection failure
    const brokenSource: BackupQueryable = {
      query: async () => { throw new Error('Connection refused'); },
      exec: async () => { throw new Error('Connection refused'); },
    };

    const result = await createBackup(
      brokenSource,
      TEST_ENCRYPTION_KEY,
      'responsible-person@example.com',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.ownerEmail).toBe('responsible-person@example.com');
  });
});

// ===========================================================================
// Encryption unit tests
// ===========================================================================

describe('Encryption primitives', () => {
  it('encrypt and decrypt round-trips correctly', () => {
    const plaintext = JSON.stringify({ test: 'data', num: 42 });
    const encrypted = encryptData(plaintext, TEST_ENCRYPTION_KEY);
    const decrypted = decryptData(
      encrypted.data,
      encrypted.iv,
      encrypted.authTag,
      TEST_ENCRYPTION_KEY,
    );

    expect(decrypted).toBe(plaintext);
  });

  it('decrypt throws with wrong key (GCM auth failure)', () => {
    const encrypted = encryptData('secret data', TEST_ENCRYPTION_KEY);
    expect(() => {
      decryptData(encrypted.data, encrypted.iv, encrypted.authTag, 'wrong-key-32-chars-long-enough!');
    }).toThrow();
  });

  it('decrypt throws when data is tampered (integrity check)', () => {
    const encrypted = encryptData('secret data', TEST_ENCRYPTION_KEY);
    const tamperedData = encrypted.data.slice(0, -4) + 'AAAA';
    expect(() => {
      decryptData(tamperedData, encrypted.iv, encrypted.authTag, TEST_ENCRYPTION_KEY);
    }).toThrow();
  });

  it('verifyBackupIntegrity returns true for valid backup', async () => {
    const pg = await createPglite();
    try {
      await migrateDb(pg);
      await seedCommercialData(pg);

      const source = pgliteQueryable(pg);
      const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

      expect(verifyBackupIntegrity(result.backup!, TEST_ENCRYPTION_KEY)).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it('verifyBackupIntegrity returns false for tampered checksum', async () => {
    const pg = await createPglite();
    try {
      await migrateDb(pg);
      await seedCommercialData(pg);

      const source = pgliteQueryable(pg);
      const result = await createBackup(source, TEST_ENCRYPTION_KEY, 'ops@example.com');

      // Tamper with checksum
      const tampered = {
        ...result.backup!,
        metadata: {
          ...result.backup!.metadata,
          checksum: 'a'.repeat(64),
        },
      };

      expect(verifyBackupIntegrity(tampered, TEST_ENCRYPTION_KEY)).toBe(false);
    } finally {
      await pg.close();
    }
  });
});
