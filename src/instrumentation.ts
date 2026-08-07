/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Next.js server starts, before accepting any traffic.
 * This is the canonical place to perform fail-closed configuration checks.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const { assertEnvOrExit } = await import('./lib/env');
  assertEnvOrExit();
}
