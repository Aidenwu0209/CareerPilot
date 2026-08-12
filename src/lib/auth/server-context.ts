import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { resolveContext, type RequestContext } from './context';
import { FINGERPRINT_COOKIE_NAME } from './providers/fingerprint';

/**
 * Resolve auth for Server Components in both production auth mode and the
 * development-only fingerprint mode.
 */
export async function resolveServerContext(): Promise<RequestContext | null> {
  const sessionContext = await resolveContext();
  if (sessionContext || !config.runtime.demoMode) return sessionContext;

  const cookieStore = await cookies();
  const fingerprint = cookieStore.get(FINGERPRINT_COOKIE_NAME)?.value ?? null;
  return resolveContext(fingerprint);
}
