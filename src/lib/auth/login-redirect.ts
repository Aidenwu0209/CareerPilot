import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

export function buildLoginRedirect(locale: string, callbackPath: string): string {
  const normalizedCallback = callbackPath.startsWith('/') ? callbackPath : `/${callbackPath}`;
  const localizedCallback = normalizedCallback.startsWith(`/${locale}/`)
    ? normalizedCallback
    : `/${locale}${normalizedCallback}`;

  return `/${locale}/login?callbackUrl=${encodeURIComponent(localizedCallback)}`;
}

export function normalizeInternalCallbackUrl(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate?.startsWith('/') || candidate.startsWith('//')) return fallback;

  try {
    const base = new URL('https://careerpilot.local');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export async function redirectToLogin(callbackPath: string): Promise<never> {
  const locale = await getLocale();
  redirect(buildLoginRedirect(locale, callbackPath));
}
