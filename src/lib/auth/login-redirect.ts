import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

export function buildLoginRedirect(locale: string, callbackPath: string): string {
  const normalizedCallback = callbackPath.startsWith('/')
    ? callbackPath
    : `/${callbackPath}`;
  const localizedCallback = `/${locale}${normalizedCallback}`;

  return `/${locale}/login?callbackUrl=${encodeURIComponent(localizedCallback)}`;
}

export async function redirectToLogin(callbackPath: string): Promise<never> {
  const locale = await getLocale();
  redirect(buildLoginRedirect(locale, callbackPath));
}
