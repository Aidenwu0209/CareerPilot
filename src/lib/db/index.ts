import { config } from '@/lib/config';
import { SQLiteAdapter } from './adapters/sqlite';
import { PostgreSQLAdapter } from './adapters/postgresql';
import type { DatabaseAdapter } from './adapter';

const isProduction = process.env.NODE_ENV === 'production';

let adapter: DatabaseAdapter;

if (config.db.type === 'postgresql') {
  adapter = new PostgreSQLAdapter(process.env.DATABASE_URL!);
} else {
  if (process.env.VERCEL || isProduction) {
    throw new Error(
      'SQLite is not supported in production or on Vercel (read-only filesystem). ' +
      'Please set DB_TYPE=postgresql and DATABASE_URL in your environment variables.',
    );
  }
  adapter = new SQLiteAdapter(process.env.SQLITE_PATH || './data/careerpilot.db');
}

// Initialize (migrate + seed) — must complete before first query.
// In production, initialization failures MUST reject the promise so that
// readiness checks fail and the deployment layer stops routing traffic.
// In development, we catch and log to keep the DX smooth.
const _initPromise = isProduction
  ? adapter.initialize()
  : adapter.initialize().catch((e) => console.error('[DB] Initialize failed:', e));

/** Await this before any DB operation to ensure tables exist */
export const dbReady = _initPromise;

export const db = adapter.db;
export { adapter };
