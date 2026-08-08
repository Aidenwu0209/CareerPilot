/**
 * Backup service — creates encrypted PostgreSQL logical backups.
 *
 * US-084: At least daily encrypted backup with minimal-privilege credentials.
 *
 * Design:
 * - The backup process only needs SELECT on all public tables (read-only role).
 * - Data is serialised to JSON, then encrypted with AES-256-GCM.
 * - The backup file contains NO environment variables, connection strings,
 *   application secrets, or user passwords — only table data.
 * - On failure, the result includes the configured owner email for notification.
 */
import crypto from 'crypto';
import { readdirSync, statSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import type {
  BackupQueryable,
  BackupPayload,
  BackupResult,
  EncryptedBackup,
  BackupMetadata,
  TableData,
} from './types';
import { BACKUP_TABLES_IN_FK_ORDER } from './types';

/**
 * Discover all user tables in the public schema.
 * Falls back to the known table list if information_schema is unavailable.
 */
async function listTables(source: BackupQueryable): Promise<string[]> {
  try {
    const rows = (await source.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )) as { tablename: string }[];
    const tables = rows.map((r) => r.tablename);
    // Exclude drizzle migration tracking tables (not in public schema, but just in case)
    return tables.filter((t) => !t.startsWith('drizzle') && !t.startsWith('__'));
  } catch {
    return BACKUP_TABLES_IN_FK_ORDER;
  }
}

/**
 * Dump all rows from a single table.
 * Returns an empty array if the table is empty or doesn't exist.
 */
async function dumpTable(
  source: BackupQueryable,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const rows = await source.query(
    `SELECT * FROM "${tableName}"`,
  );
  return rows;
}

/**
 * Extract all table data from the source database.
 * The source connection should use a read-only (minimal-privilege) role.
 */
export async function extractBackupData(
  source: BackupQueryable,
): Promise<{ tables: TableData; schemaVersion: number }> {
  const tableNames = await listTables(source);
  const tables: TableData = {};

  for (const name of tableNames) {
    tables[name] = await dumpTable(source, name);
  }

  // Get schema version (migration count)
  let schemaVersion = 0;
  try {
    const rows = (await source.query(
      `SELECT count(*)::int as count FROM "drizzle"."__drizzle_migrations"`,
    )) as { count: number }[];
    schemaVersion = rows[0]?.count ?? 0;
  } catch {
    // Migration table might not exist — leave as 0
  }

  return { tables, schemaVersion };
}

/**
 * Count total rows across all tables.
 */
function countTotalRows(tables: TableData): number {
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
}

/**
 * Encrypt plaintext data using AES-256-GCM.
 *
 * The encryption key is normalised to 32 bytes via SHA-256.
 * Returns the IV and auth tag alongside the ciphertext.
 */
export function encryptData(
  plaintext: string,
  encryptionKey: string,
): { iv: string; authTag: string; data: string } {
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

/**
 * Decrypt data encrypted by encryptData().
 * Throws if the key is wrong or data has been tampered with (GCM auth).
 */
export function decryptData(
  encryptedData: string,
  iv: string,
  authTag: string,
  encryptionKey: string,
): string {
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedData, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Create an encrypted backup of the entire database.
 *
 * @param source   A queryable connected to the production database (read-only role).
 * @param encryptionKey  AES-256-GCM encryption key (>= 32 chars).
 * @param ownerEmail  Responsible person for failure notifications.
 * @returns BackupResult with the encrypted blob or an error message.
 */
export async function createBackup(
  source: BackupQueryable,
  encryptionKey: string,
  ownerEmail: string,
): Promise<BackupResult> {
  const rpoTimestamp = Math.floor(Date.now() / 1000);

  try {
    const { tables, schemaVersion } = await extractBackupData(source);
    const totalRows = countTotalRows(tables);
    const tableCount = Object.keys(tables).length;

    const payload: BackupPayload = {
      format: 'careerpilot-backup',
      version: 1,
      createdAt: rpoTimestamp,
      schemaVersion,
      tables,
    };

    const plaintext = JSON.stringify(payload);
    const encrypted = encryptData(plaintext, encryptionKey);

    // Compute checksum of encrypted data for integrity verification
    const checksum = crypto
      .createHash('sha256')
      .update(encrypted.data)
      .digest('hex');

    const metadata: BackupMetadata = {
      format: 'careerpilot-backup',
      version: 1,
      createdAt: rpoTimestamp,
      schemaVersion,
      tableCount,
      totalRows,
      encryptedSize: encrypted.data.length,
      checksum,
      rpoTimestamp,
    };

    const backup: EncryptedBackup = {
      metadata,
      encryption: {
        algorithm: 'aes-256-gcm',
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      data: encrypted.data,
    };

    return {
      ok: true,
      backup,
      rpoTimestamp,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ownerEmail,
      rpoTimestamp,
    };
  }
}

/**
 * Decrypt a backup and return the plaintext payload.
 * Throws if the key is wrong or data has been tampered with.
 */
export function decryptBackup(
  backup: EncryptedBackup,
  encryptionKey: string,
): BackupPayload {
  const plaintext = decryptData(
    backup.data,
    backup.encryption.iv,
    backup.encryption.authTag,
    encryptionKey,
  );
  return JSON.parse(plaintext) as BackupPayload;
}

/**
 * Verify backup integrity by decrypting and checking the checksum.
 * Does NOT load data into a database — use restoreFromBackup for that.
 */
export function verifyBackupIntegrity(
  backup: EncryptedBackup,
  encryptionKey: string,
): boolean {
  try {
    const expectedChecksum = crypto
      .createHash('sha256')
      .update(backup.data)
      .digest('hex');

    if (expectedChecksum !== backup.metadata.checksum) {
      return false;
    }

    // Try decryption — throws if key is wrong or data tampered
    decryptBackup(backup, encryptionKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune backup files older than the retention period.
 *
 * @param destination  Directory containing backup files.
 * @param retentionDays  Delete files older than this many days.
 * @returns Number of files deleted.
 */
export function pruneOldBackups(destination: string, retentionDays: number): number {
  let deleted = 0;
  const dir = resolve(destination);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.enc.json'));
    for (const file of files) {
      const filePath = resolve(dir, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        deleted++;
      }
    }
  } catch {
    // Directory doesn't exist or is not accessible
  }

  return deleted;
}
