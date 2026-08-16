import { config } from '@/lib/config';
import { SQLiteAdapter } from './adapters/sqlite';
import { PostgreSQLAdapter } from './adapters/postgresql';
import type { DatabaseAdapter } from './adapter';
import { logger } from '@/lib/observability/logger';

const isProduction = process.env.NODE_ENV === 'production';
const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build';

let adapter: DatabaseAdapter;

if (config.db.type === 'postgresql') {
  adapter = new PostgreSQLAdapter(process.env.DATABASE_URL!);
} else {
  if ((process.env.VERCEL || isProduction) && !isBuildPhase) {
    throw new Error(
      'SQLite is not supported in production or on Vercel (read-only filesystem). ' +
      'Please set DB_TYPE=postgresql and DATABASE_URL in your environment variables.',
    );
  }
  // Next imports route modules while collecting build metadata. Use an
  // isolated in-memory schema for that phase; production runtime still rejects
  // SQLite above and therefore remains PostgreSQL-only.
  adapter = new SQLiteAdapter(isBuildPhase ? ':memory:' : (process.env.SQLITE_PATH || './data/careerpilot.db'));
}

// Initialize (migrate + seed) — must complete before first query.
// In production, initialization failures MUST reject the promise so that
// readiness checks fail and the deployment layer stops routing traffic.
// In development, we catch and log to keep the DX smooth.
// Next.js imports server modules while collecting route metadata. Database
// availability is a runtime readiness concern, so builds must stay offline and
// deterministic. `pnpm start` does not carry the build lifecycle marker and
// still performs the fail-closed production initialization below.
const _initPromise = isBuildPhase
  ? Promise.resolve()
  : isProduction
    ? adapter.initialize()
    : adapter.initialize().catch((error) => logger.error('db.initialize_failed', { error }));

/** Await this before any DB operation to ensure tables exist */
export const dbReady = _initPromise;

export const db = adapter.db;
export { adapter };
