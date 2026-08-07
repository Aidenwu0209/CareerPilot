import { NextResponse } from 'next/server';
import { dbReady } from '@/lib/db';

/**
 * Readiness / health check endpoint.
 *
 * Returns 200 when the app is ready to serve traffic:
 * - The process is running (trivially true if this route responds)
 * - The database is initialized and migrations have completed
 *
 * Returns 503 when the app is NOT ready, with a safe, non-sensitive message.
 * Never exposes connection strings, secrets, user data, or internal errors.
 */
export async function GET() {
  let dbOk = false;
  let dbError = '';

  try {
    await dbReady;
    dbOk = true;
  } catch {
    dbOk = false;
    dbError = 'database initialization failed';
  }

  const ok = dbOk;

  return NextResponse.json(
    {
      status: ok ? 'ok' : 'unavailable',
      ...(dbError ? { db: dbError } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
