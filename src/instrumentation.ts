/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Next.js server starts, before accepting any traffic.
 * This is the canonical place to perform fail-closed configuration checks.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Database initialization and fail-closed environment checks require the
  // Node.js runtime. Next.js also evaluates instrumentation for Edge bundles,
  // where importing the DB adapters would emit runtime errors for fs/path.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertEnvOrExit } = await import('./lib/env');
  assertEnvOrExit();

  // Run super admin bootstrap after the database is ready.
  // Bootstrap failures are logged but do not prevent startup.
  try {
    const { dbReady } = await import('./lib/db');
    await dbReady;
    const { bootstrapSuperAdmin } = await import('./lib/bootstrap/super-admin');
    await bootstrapSuperAdmin();
  } catch (e) {
    console.error('[Instrumentation] Super admin bootstrap failed:', e);
  }
}
