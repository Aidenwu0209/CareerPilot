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
  const { registerOTel } = await import('@vercel/otel');
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'careerpilot-web' });
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build'
  ) return;

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

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { dispatchAlert } = await import('./lib/observability/alerts');
  const message = error instanceof Error ? error.message : String(error);
  await dispatchAlert({
    fingerprint: `next-error:${context.routePath}:${message.slice(0, 160)}`,
    source: 'nextjs-onRequestError',
    severity: 'critical',
    title: `Unhandled server error on ${context.routePath}`,
    message,
    details: { method: request.method, path: request.path, routeType: context.routeType },
  });
}
