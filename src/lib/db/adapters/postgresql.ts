import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { DatabaseAdapter } from '../adapter';
import { resolve } from 'path';
import { logger } from '@/lib/observability/logger';

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function resolvePostgresOptions(env: NodeJS.ProcessEnv = process.env) {
  const sslMode = env.DATABASE_SSL_MODE?.trim().toLowerCase();
  const ssl: false | 'require' | 'allow' | 'prefer' | 'verify-full' = sslMode === 'disable'
    ? false
    : sslMode === 'require' || sslMode === 'allow' || sslMode === 'prefer' || sslMode === 'verify-full'
      ? sslMode
      : env.NODE_ENV === 'production' ? 'verify-full' as const : 'prefer' as const;

  return {
    max: readBoundedInteger(env.DATABASE_POOL_MAX, 10, 1, 100),
    idle_timeout: readBoundedInteger(env.DATABASE_IDLE_TIMEOUT_SECONDS, 20, 1, 600),
    connect_timeout: readBoundedInteger(env.DATABASE_CONNECT_TIMEOUT_SECONDS, 10, 1, 120),
    max_lifetime: readBoundedInteger(env.DATABASE_MAX_LIFETIME_SECONDS, 1_800, 60, 86_400),
    ssl,
  };
}

export class PostgreSQLAdapter implements DatabaseAdapter {
  db;
  private client: ReturnType<typeof postgres>;

  constructor(connectionString: string) {
    this.client = postgres(connectionString, resolvePostgresOptions());
    this.db = drizzle(this.client);
  }

  async initialize(): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';

    // Auto-run migrations (PG-native migration files).
    // In production, migration failures MUST propagate (fail-closed).
    if (isProduction) {
      await migrate(this.db, {
        migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
      });

      // Sanity check: if migration tracking says "done" but tables are missing
      // (e.g. after a manual DROP SCHEMA), reset tracking and re-run
      const check = await this.db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS ok`
      );
      if (!check[0]?.ok) {
        logger.warn('db.postgresql_migration_tracking_stale');
        await this.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
        await migrate(this.db, {
          migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
        });
      }

      logger.info('db.postgresql_migrations_applied');
    } else {
      try {
        await migrate(this.db, {
          migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
        });

        const check = await this.db.execute(
          sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS ok`
        );
        if (!check[0]?.ok) {
          logger.warn('db.postgresql_migration_tracking_stale');
          await this.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
          await migrate(this.db, {
            migrationsFolder: resolve(process.cwd(), 'drizzle/pg-migrations'),
          });
        }

        logger.info('db.postgresql_migrations_applied');
      } catch (e) {
        logger.error('db.postgresql_migration_failed', { error: e });
      }
    }

    // Skip auto-seeding in production — no demo/fingerprint users or sample resumes.
    if (isProduction || process.env.DEMO_MODE !== 'true' || process.env.CAREERPILOT_SKIP_DEMO_SEED === '1') {
      return;
    }

    // Auto-seed if empty (development only)
    try {
      const result = await this.db.execute(sql`SELECT count(*)::int as count FROM users`);
      const count = Number(result[0]?.count ?? 0);
      if (count === 0) {
        const { seedDemoUser } = await import('../seed-demo');
        await seedDemoUser(this.db);
        logger.info('db.postgresql_auto_seed_complete');
      }
    } catch (e) {
      logger.error('db.postgresql_auto_seed_failed', { error: e });
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
