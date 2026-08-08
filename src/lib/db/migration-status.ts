/**
 * Migration status helpers.
 *
 * Provides functions to determine whether the database has applied all
 * expected migrations. Used by the production readiness check.
 */
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'drizzle-orm';

/** Minimal interface for a Drizzle-compatible query executor. */
export interface MigrationQueryable {
  execute(query: unknown): Promise<Array<Record<string, unknown>>>;
}

/**
 * Count the expected PostgreSQL migration files on disk.
 *
 * Each `.sql` file in `drizzle/pg-migrations/` represents one migration
 * that should have been applied. The `meta/` folder is excluded because
 * it only contains journal and snapshot files.
 */
export function getExpectedPGMigrationCount(): number {
  try {
    const dir = resolve(process.cwd(), 'drizzle/pg-migrations');
    return readdirSync(dir).filter((f) => f.endsWith('.sql')).length;
  } catch {
    return 0;
  }
}

/**
 * Count applied PostgreSQL migrations from the drizzle tracking table.
 *
 * Drizzle stores one row per applied migration in
 * `drizzle."__drizzle_migrations"`. Returns 0 when the table does not
 * exist yet (fresh database) or the query fails for any reason.
 */
export async function getAppliedPGMigrationCount(db: MigrationQueryable): Promise<number> {
  try {
    const result = await db.execute(
      sql`SELECT count(*)::int as count FROM "drizzle"."__drizzle_migrations"`,
    );
    return Number(result[0]?.count ?? 0);
  } catch {
    // Table doesn't exist or query failed — treat as 0 applied.
    return 0;
  }
}
