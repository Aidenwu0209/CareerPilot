/**
 * Backup and restore types, configuration, and constants.
 *
 * US-084: Encrypted PostgreSQL backup and restore verification.
 *
 * The backup service produces an encrypted logical dump of all production
 * tables. The restore service can load the dump into an isolated environment
 * and verify integrity (balance recompute, FK relationships, row counts).
 */

// ---------------------------------------------------------------------------
// Queryable interface
// ---------------------------------------------------------------------------

/**
 * Minimal query interface compatible with both PGlite (tests) and the
 * `postgres` npm package (production).
 *
 * In production, the backup process should connect with a **read-only** role
 * that has SELECT on all public tables but no INSERT/UPDATE/DELETE.
 * The restore process connects to a separate (isolated) database.
 */
export interface BackupQueryable {
  /** Execute a SELECT query and return rows. */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /** Execute a statement (INSERT, TRUNCATE, SET, etc.). */
  exec(sql: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BackupConfig {
  /** Whether automated backups are enabled. */
  enabled: boolean;
  /** Directory or URI where encrypted backups are stored. Must be isolated from the DB node. */
  destination: string;
  /** Retention period in days. Backups older than this are pruned. */
  retentionDays: number;
  /** Email of the person responsible for backup operations (notified on failure). */
  ownerEmail: string;
  /** Encryption key for AES-256-GCM. Must be at least 32 characters. */
  encryptionKey: string;
  /** Minimum cron schedule — "daily" means at least once per 24h. */
  schedule: 'daily' | 'hourly';
}

export interface BackupConfigIssue {
  field: string;
  message: string;
}

export interface BackupConfigResult {
  ok: boolean;
  issues: BackupConfigIssue[];
}

/**
 * Validate backup configuration from environment variables.
 *
 * In production, all fields must be present and valid.
 * In development, returns ok:false with warnings but does not block startup.
 */
export function validateBackupConfig(env: Record<string, string | undefined>): BackupConfigResult {
  const issues: BackupConfigIssue[] = [];
  const isProd = env.NODE_ENV === 'production';
  const enabled = env.BACKUP_ENABLED === 'true';

  if (!enabled) {
    if (isProd) {
      issues.push({
        field: 'BACKUP_ENABLED',
        message: 'BACKUP_ENABLED must be "true" in production.',
      });
    }
    return { ok: issues.length === 0, issues };
  }

  const dest = env.BACKUP_DESTINATION || '';
  if (!dest) {
    issues.push({
      field: 'BACKUP_DESTINATION',
      message: 'BACKUP_DESTINATION is required when backups are enabled. Must be isolated from the DB node.',
    });
  }

  const retention = parseInt(env.BACKUP_RETENTION_DAYS || '0', 10);
  if (!retention || retention < 1) {
    issues.push({
      field: 'BACKUP_RETENTION_DAYS',
      message: 'BACKUP_RETENTION_DAYS must be a positive integer (>= 1).',
    });
  }

  const owner = env.BACKUP_OWNER_EMAIL || '';
  if (!owner || !owner.includes('@')) {
    issues.push({
      field: 'BACKUP_OWNER_EMAIL',
      message: 'BACKUP_OWNER_EMAIL must be a valid email address (for failure notifications).',
    });
  }

  const key = env.BACKUP_ENCRYPTION_KEY || '';
  if (!key) {
    issues.push({
      field: 'BACKUP_ENCRYPTION_KEY',
      message: 'BACKUP_ENCRYPTION_KEY is required for AES-256-GCM encryption.',
    });
  } else if (key.length < 32) {
    issues.push({
      field: 'BACKUP_ENCRYPTION_KEY',
      message: 'BACKUP_ENCRYPTION_KEY must be at least 32 characters.',
    });
  } else if (
    key === env.AUTH_SECRET ||
    key === env.AI_CREDENTIAL_MASTER_KEY
  ) {
    issues.push({
      field: 'BACKUP_ENCRYPTION_KEY',
      message: 'BACKUP_ENCRYPTION_KEY must be different from AUTH_SECRET and AI_CREDENTIAL_MASTER_KEY.',
    });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Parse backup config from environment variables.
 * Returns null if backups are not enabled.
 */
export function parseBackupConfig(env: Record<string, string | undefined>): BackupConfig | null {
  if (env.BACKUP_ENABLED !== 'true') return null;

  return {
    enabled: true,
    destination: env.BACKUP_DESTINATION || '',
    retentionDays: parseInt(env.BACKUP_RETENTION_DAYS || '7', 10),
    ownerEmail: env.BACKUP_OWNER_EMAIL || '',
    encryptionKey: env.BACKUP_ENCRYPTION_KEY || '',
    schedule: (env.BACKUP_SCHEDULE as 'daily' | 'hourly') || 'daily',
  };
}

// ---------------------------------------------------------------------------
// Backup data structures
// ---------------------------------------------------------------------------

/** Serialised table data keyed by table name. */
export type TableData = Record<string, Record<string, unknown>[]>;

/** Plaintext backup payload before encryption. */
export interface BackupPayload {
  format: 'careerpilot-backup';
  version: 1;
  createdAt: number;
  schemaVersion: number;
  tables: TableData;
}

/** Metadata embedded in the encrypted backup file (safe to expose). */
export interface BackupMetadata {
  format: 'careerpilot-backup';
  version: 1;
  createdAt: number;
  schemaVersion: number;
  tableCount: number;
  totalRows: number;
  encryptedSize: number;
  checksum: string;
  rpoTimestamp: number;
}

/** Encrypted backup blob ready for storage. */
export interface EncryptedBackup {
  metadata: BackupMetadata;
  encryption: {
    algorithm: 'aes-256-gcm';
    iv: string;
    authTag: string;
  };
  data: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface BackupResult {
  ok: boolean;
  backup?: EncryptedBackup;
  error?: string;
  /** Owner to notify when backup fails. */
  ownerEmail?: string;
  /** RPO timestamp (when the backup was initiated). */
  rpoTimestamp: number;
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  /** Seconds taken to restore (RTO). */
  rtoSeconds: number;
  /** RPO timestamp from the backup metadata. */
  rpoTimestamp: number;
  /** Effective RPO in seconds (now - backup createdAt). */
  effectiveRpoSeconds: number;
  verification?: RestoreVerificationResult;
}

export interface RestoreVerificationResult {
  ok: boolean;
  balanceCheck: BalanceCheckResult;
  foreignKeyCheck: ForeignKeyCheckResult;
  rowCountCheck: RowCountCheckResult;
}

export interface BalanceCheckResult {
  ok: boolean;
  accountsChecked: number;
  mismatches: Array<{
    accountId: string;
    storedBalance: number;
    computedBalance: number;
    diff: number;
  }>;
}

export interface ForeignKeyCheckResult {
  ok: boolean;
  totalConstraints: number;
  violations: string[];
}

export interface RowCountCheckResult {
  ok: boolean;
  tables: Array<{
    table: string;
    sourceCount: number;
    restoredCount: number;
    match: boolean;
  }>;
}

export interface DrillRecord {
  backupCreatedAt: number;
  restoredAt: number;
  rpoSeconds: number;
  rtoSeconds: number;
  verificationPassed: boolean;
  performedBy: string;
}

// ---------------------------------------------------------------------------
// Table ordering (FK dependency order for restore inserts)
// ---------------------------------------------------------------------------

/**
 * All production tables in FK dependency order.
 * Parent tables are listed before their children so that
 * row-by-row inserts during restore never violate FK constraints.
 */
export const BACKUP_TABLES_IN_FK_ORDER: string[] = [
  // Level 0: no FK deps
  'users',
  'credit_accounts',
  'ai_providers',
  'email_otps',
  // Level 1: depend on users
  'auth_accounts',
  'password_credentials',
  'resumes',
  'organizations',
  'legal_consents',
  'audit_events',
  'credit_rules',
  // Level 2
  'resume_sections',
  'chat_sessions',
  'resume_shares',
  'jd_analyses',
  'grammar_checks',
  'interview_sessions',
  'organization_memberships',
  'credit_transactions',
  'ai_models',
  // Level 3
  'chat_messages',
  'interview_rounds',
  'ai_operations',
  // Level 4
  'interview_messages',
  'interview_reports',
  'ai_provider_attempts',
  'credit_holds',
];
