/**
 * Restore service — loads encrypted backups into an isolated database
 * and verifies data integrity.
 *
 * US-084:
 * - Isolated restore environment can restore all tables from latest backup.
 * - After restore, balance recompute diff is zero, FK relationships check passes.
 * - Restore drill records actual RPO/RTO.
 */
import type {
  BackupQueryable,
  EncryptedBackup,
  RestoreResult,
  RestoreVerificationResult,
  BalanceCheckResult,
  ForeignKeyCheckResult,
  RowCountCheckResult,
  TableData,
  DrillRecord,
} from './types';
import { BACKUP_TABLES_IN_FK_ORDER } from './types';
import { decryptBackup } from './backup-service';

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Escape a string identifier for use as a SQL column or table name.
 * Wraps in double quotes and escapes internal double quotes.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Restore an encrypted backup into the target database.
 *
 * The target should be an isolated (non-production) database that already
 * has the schema migrated (tables exist, possibly empty).
 *
 * Inserts rows in FK dependency order to avoid constraint violations.
 * Existing data in the target is TRUNCATED first (with CASCADE).
 *
 * @returns RestoreResult with RPO/RTO metrics and verification results.
 */
export async function restoreFromBackup(
  target: BackupQueryable,
  backup: EncryptedBackup,
  encryptionKey: string,
): Promise<RestoreResult> {
  const restoreStartedAt = Date.now();

  let payload;
  try {
    payload = decryptBackup(backup, encryptionKey);
  } catch (err) {
    return {
      ok: false,
      error: `Decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      rtoSeconds: (Date.now() - restoreStartedAt) / 1000,
      rpoTimestamp: backup.metadata.rpoTimestamp,
      effectiveRpoSeconds: Math.floor(Date.now() / 1000) - backup.metadata.rpoTimestamp,
    };
  }

  try {
    // Disable FK constraint triggers for the duration of the bulk load.
    // This is the standard PostgreSQL approach for restoring logical dumps
    // (pg_restore uses the same technique). Safe because we TRUNCATE first
    // and insert ALL data from the backup.
    await target.exec(`SET session_replication_role = 'replica'`);

    // Truncate all tables that have data in the backup
    const tablesWithData = BACKUP_TABLES_IN_FK_ORDER.filter(
      (t) => payload.tables[t] && payload.tables[t].length > 0,
    );

    if (tablesWithData.length > 0) {
      // Truncate in reverse FK order (children first)
      const truncateList = [...tablesWithData].reverse()
        .map(quoteIdentifier)
        .join(', ');
      await target.exec(`TRUNCATE ${truncateList} RESTART IDENTITY CASCADE`);
    }

    // Insert rows in FK dependency order
    for (const tableName of BACKUP_TABLES_IN_FK_ORDER) {
      const rows = payload.tables[tableName];
      if (!rows || rows.length === 0) continue;

      await insertRows(target, tableName, rows);
    }

    // Re-enable FK constraint triggers
    await target.exec(`SET session_replication_role = 'origin'`);

    // Run verification
    const verification = await verifyRestore(target, payload.tables);

    const restoreFinishedAt = Date.now();
    const rtoSeconds = (restoreFinishedAt - restoreStartedAt) / 1000;

    return {
      ok: verification.ok,
      rtoSeconds,
      rpoTimestamp: backup.metadata.rpoTimestamp,
      effectiveRpoSeconds: Math.floor(restoreFinishedAt / 1000) - backup.metadata.rpoTimestamp,
      verification,
    };
  } catch (err) {
    // Ensure FK triggers are re-enabled even on error
    try {
      await target.exec(`SET session_replication_role = 'origin'`);
    } catch {
      // Ignore — we're already in an error state
    }

    return {
      ok: false,
      error: `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
      rtoSeconds: (Date.now() - restoreStartedAt) / 1000,
      rpoTimestamp: backup.metadata.rpoTimestamp,
      effectiveRpoSeconds: Math.floor(Date.now() / 1000) - backup.metadata.rpoTimestamp,
    };
  }
}

/**
 * Insert rows into a table using parameterised queries.
 */
async function insertRows(
  target: BackupQueryable,
  tableName: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const colList = columns.map(quoteIdentifier).join(', ');

  for (const row of rows) {
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const values = columns.map((c) => row[c] ?? null);

    await target.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (${colList}) VALUES (${placeholders})`,
      values,
    );
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Run all post-restore verification checks.
 */
export async function verifyRestore(
  db: BackupQueryable,
  sourceTables?: TableData,
): Promise<RestoreVerificationResult> {
  const balanceCheck = await verifyBalanceIntegrity(db);
  const foreignKeyCheck = await verifyForeignKeyIntegrity(db);
  const rowCountCheck = sourceTables
    ? await verifyRowCounts(db, sourceTables)
    : { ok: true, tables: [] };

  return {
    ok: balanceCheck.ok && foreignKeyCheck.ok && rowCountCheck.ok,
    balanceCheck,
    foreignKeyCheck,
    rowCountCheck,
  };
}

/**
 * Verify that every credit account's stored balance matches the sum of
 * all transaction deltas (ledger recompute).
 *
 * AC: "恢复后余额与流水重算差异为零"
 */
export async function verifyBalanceIntegrity(
  db: BackupQueryable,
): Promise<BalanceCheckResult> {
  const accounts = await db.query(
    `SELECT id, balance FROM credit_accounts ORDER BY id`,
  ) as { id: string; balance: number }[];

  const mismatches: BalanceCheckResult['mismatches'] = [];

  for (const account of accounts) {
    const rows = await db.query(
      `SELECT COALESCE(sum(delta), 0)::int as total FROM credit_transactions WHERE account_id = $1`,
      [account.id],
    ) as { total: number }[];
    const computedBalance = rows[0]?.total ?? 0;

    if (account.balance !== computedBalance) {
      mismatches.push({
        accountId: account.id,
        storedBalance: account.balance,
        computedBalance,
        diff: account.balance - computedBalance,
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    accountsChecked: accounts.length,
    mismatches,
  };
}

/**
 * Verify all foreign key relationships are intact (no orphaned records).
 *
 * Dynamically discovers FK constraints from information_schema and checks
 * each one for violations.
 *
 * AC: "外键关系检查通过"
 */
export async function verifyForeignKeyIntegrity(
  db: BackupQueryable,
): Promise<ForeignKeyCheckResult> {
  // Discover all FK constraints from the database metadata
  let constraints: Array<{
    constraint_name: string;
    child_table: string;
    child_column: string;
    parent_table: string;
    parent_column: string;
  }>;

  try {
    constraints = (await db.query(`
      SELECT
        tc.constraint_name,
        tc.table_name AS child_table,
        kcu.column_name AS child_column,
        ccu.table_name AS parent_table,
        ccu.column_name AS parent_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.constraint_name
    `)) as typeof KNOWN_FK_CONSTRAINTS;
  } catch {
    // If information_schema query fails, use the known FK list
    constraints = KNOWN_FK_CONSTRAINTS;
  }

  const violations: string[] = [];

  for (const c of constraints) {
    // Check for orphaned child records (child.parent_id IS NOT NULL but no matching parent)
    const rows = (await db.query(
      `SELECT count(*)::int as cnt
       FROM "${c.child_table}" child
       LEFT JOIN "${c.parent_table}" parent
         ON child."${c.child_column}" = parent."${c.parent_column}"
       WHERE child."${c.child_column}" IS NOT NULL
         AND parent."${c.parent_column}" IS NULL`,
    )) as { cnt: number }[];
    const cnt = rows[0]?.cnt ?? 0;
    if (cnt > 0) {
      violations.push(
        `${c.constraint_name}: ${cnt} orphaned record(s) in ${c.child_table}.${c.child_column} → ${c.parent_table}.${c.parent_column}`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    totalConstraints: constraints.length,
    violations,
  };
}

/**
 * Verify that row counts match between source and restored databases.
 */
export async function verifyRowCounts(
  db: BackupQueryable,
  sourceTables: TableData,
): Promise<RowCountCheckResult> {
  const results: RowCountCheckResult['tables'] = [];

  for (const [tableName, sourceRows] of Object.entries(sourceTables)) {
    const sourceCount = sourceRows.length;
    const rows = (await db.query(
      `SELECT count(*)::int as cnt FROM "${tableName}"`,
    )) as { cnt: number }[];
    const restoredCount = rows[0]?.cnt ?? 0;

    results.push({
      table: tableName,
      sourceCount,
      restoredCount,
      match: sourceCount === restoredCount,
    });
  }

  return {
    ok: results.every((r) => r.match),
    tables: results,
  };
}

/**
 * Record a restore drill for audit purposes.
 *
 * AC: "恢复演练记录实际 RPO/RTO"
 */
export function recordDrill(
  backupCreatedAt: number,
  rtoSeconds: number,
  verificationPassed: boolean,
  performedBy: string,
): DrillRecord {
  const restoredAt = Math.floor(Date.now() / 1000);
  return {
    backupCreatedAt,
    restoredAt,
    rpoSeconds: restoredAt - backupCreatedAt,
    rtoSeconds,
    verificationPassed,
    performedBy,
  };
}

// ---------------------------------------------------------------------------
// Known FK constraints (fallback if information_schema query fails)
// ---------------------------------------------------------------------------

const KNOWN_FK_CONSTRAINTS = [
  { constraint_name: 'auth_accounts_user_id_users_id_fk', child_table: 'auth_accounts', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'password_credentials_user_id_users_id_fk', child_table: 'password_credentials', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'resumes_user_id_users_id_fk', child_table: 'resumes', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'resume_sections_resume_id_resumes_id_fk', child_table: 'resume_sections', child_column: 'resume_id', parent_table: 'resumes', parent_column: 'id' },
  { constraint_name: 'chat_sessions_resume_id_resumes_id_fk', child_table: 'chat_sessions', child_column: 'resume_id', parent_table: 'resumes', parent_column: 'id' },
  { constraint_name: 'chat_messages_session_id_chat_sessions_id_fk', child_table: 'chat_messages', child_column: 'session_id', parent_table: 'chat_sessions', parent_column: 'id' },
  { constraint_name: 'resume_shares_resume_id_resumes_id_fk', child_table: 'resume_shares', child_column: 'resume_id', parent_table: 'resumes', parent_column: 'id' },
  { constraint_name: 'jd_analyses_resume_id_resumes_id_fk', child_table: 'jd_analyses', child_column: 'resume_id', parent_table: 'resumes', parent_column: 'id' },
  { constraint_name: 'grammar_checks_resume_id_resumes_id_fk', child_table: 'grammar_checks', child_column: 'resume_id', parent_table: 'resumes', parent_column: 'id' },
  { constraint_name: 'interview_sessions_user_id_users_id_fk', child_table: 'interview_sessions', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'interview_rounds_session_id_interview_sessions_id_fk', child_table: 'interview_rounds', child_column: 'session_id', parent_table: 'interview_sessions', parent_column: 'id' },
  { constraint_name: 'interview_messages_round_id_interview_rounds_id_fk', child_table: 'interview_messages', child_column: 'round_id', parent_table: 'interview_rounds', parent_column: 'id' },
  { constraint_name: 'organizations_created_by_users_id_fk', child_table: 'organizations', child_column: 'created_by', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'organization_memberships_organization_id_organizations_id_fk', child_table: 'organization_memberships', child_column: 'organization_id', parent_table: 'organizations', parent_column: 'id' },
  { constraint_name: 'organization_memberships_user_id_users_id_fk', child_table: 'organization_memberships', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'credit_transactions_account_id_credit_accounts_id_fk', child_table: 'credit_transactions', child_column: 'account_id', parent_table: 'credit_accounts', parent_column: 'id' },
  { constraint_name: 'ai_models_provider_id_ai_providers_id_fk', child_table: 'ai_models', child_column: 'provider_id', parent_table: 'ai_providers', parent_column: 'id' },
  { constraint_name: 'ai_operations_actor_id_users_id_fk', child_table: 'ai_operations', child_column: 'actor_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'ai_operations_billing_account_id_credit_accounts_id_fk', child_table: 'ai_operations', child_column: 'billing_account_id', parent_table: 'credit_accounts', parent_column: 'id' },
  { constraint_name: 'ai_provider_attempts_operation_id_ai_operations_id_fk', child_table: 'ai_provider_attempts', child_column: 'operation_id', parent_table: 'ai_operations', parent_column: 'id' },
  { constraint_name: 'ai_provider_attempts_model_id_ai_models_id_fk', child_table: 'ai_provider_attempts', child_column: 'model_id', parent_table: 'ai_models', parent_column: 'id' },
  { constraint_name: 'credit_holds_account_id_credit_accounts_id_fk', child_table: 'credit_holds', child_column: 'account_id', parent_table: 'credit_accounts', parent_column: 'id' },
  { constraint_name: 'credit_holds_operation_id_ai_operations_id_fk', child_table: 'credit_holds', child_column: 'operation_id', parent_table: 'ai_operations', parent_column: 'id' },
  { constraint_name: 'audit_events_actor_id_users_id_fk', child_table: 'audit_events', child_column: 'actor_id', parent_table: 'users', parent_column: 'id' },
  { constraint_name: 'legal_consents_user_id_users_id_fk', child_table: 'legal_consents', child_column: 'user_id', parent_table: 'users', parent_column: 'id' },
];
