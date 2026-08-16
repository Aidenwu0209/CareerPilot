import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../schema';
import type { DatabaseAdapter } from '../adapter';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { logger } from '@/lib/observability/logger';
import { reconcileKnownLegacySQLiteMigration } from '../sqlite-migration-compat';

export class SQLiteAdapter implements DatabaseAdapter {
  db;
  private sqlite: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });

    // Auto-run migrations (synchronous for SQLite).
    // In production, migration failures must propagate (fail-closed).
    const isProduction = process.env.NODE_ENV === 'production';
    const migrationsFolder = resolve(process.cwd(), 'drizzle/migrations');
    if (isProduction) {
      migrate(this.db, { migrationsFolder });
    } else {
      try {
        reconcileKnownLegacySQLiteMigration(this.sqlite, migrationsFolder);
        migrate(this.db, { migrationsFolder });
      } catch (e) {
        logger.error('db.sqlite_migration_failed', { error: e });
      }
    }
  }

  async initialize(): Promise<void> {
    // Skip auto-seeding in production — no demo/fingerprint users or sample resumes.
    if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true' || process.env.CAREERPILOT_SKIP_DEMO_SEED === '1') {
      return;
    }

    try {
      const row = this.sqlite.prepare('SELECT count(*) as count FROM users').get() as { count: number } | undefined;
      if (row?.count === 0) {
        const { seedDemoUser } = await import('../seed-demo');
        await seedDemoUser(this.db);
        logger.info('db.sqlite_auto_seed_complete');
      }
    } catch (e) {
      logger.error('db.sqlite_auto_seed_failed', { error: e });
    }
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}
