import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { config as appConfig } from './lib/config';
import { isDemoFingerprint } from './lib/auth/demo-mode';
import { FINGERPRINT_COOKIE_NAME } from './lib/auth/providers/fingerprint';
import { decode } from 'next-auth/jwt';
import { REQUEST_ID_HEADER, resolveRequestId } from './lib/http/request-id';

const intlProxy = createMiddleware(routing);

const PUBLIC_PAGE_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/help',
  '/privacy',
  '/terms',
  '/share',
  '/demo',
];

const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/branding',
  '/api/health',
  '/api/share',
  '/api/webhooks/stripe',
  '/api/internal',
];

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(zh|en)(?=\/|$)/, '') || '/';
}

function isPublicPagePath(pathname: string): boolean {
  const path = stripLocale(pathname);
  return PUBLIC_PAGE_PATHS.some((publicPath) =>
    publicPath === '/'
      ? path === '/'
      : path === publicPath || path.startsWith(`${publicPath}/`),
  );
}

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isOnboardingAllowedPage(pathname: string): boolean {
  return ['/onboarding', '/auth/complete', '/forgot-password', '/help', '/privacy', '/terms'].includes(
    stripLocale(pathname),
  );
}

async function getSessionState(request: NextRequest): Promise<{
  authenticated: boolean;
  onboardingRequired: boolean;
}> {
  const cookieName = request.cookies.has('__Secure-authjs.session-token')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return { authenticated: false, onboardingRequired: false };

  const secret = process.env.AUTH_SECRET;
  if (!secret) return { authenticated: false, onboardingRequired: false };
  try {
    const payload = await decode({ token, secret, salt: cookieName });
    return {
      authenticated: Boolean(payload?.userId || payload?.sub),
      onboardingRequired: payload?.onboardingRequired === true,
    };
  } catch {
    return { authenticated: false, onboardingRequired: false };
  }
}

function hasDemoIdentity(request: NextRequest): boolean {
  if (!appConfig.runtime.demoMode) return false;
  return isDemoFingerprint(request.cookies.get(FINGERPRINT_COOKIE_NAME)?.value);
}

function getLocale(pathname: string): 'zh' | 'en' {
  const locale = pathname.match(/^\/(zh|en)(?=\/|$)/)?.[1];
  return locale === 'en' ? 'en' : 'zh';
}

function getLocalizedCallback(request: NextRequest, locale: string): string {
  const { pathname, search } = request.nextUrl;
  const localizedPath = /^\/(zh|en)(?=\/|$)/.test(pathname)
    ? pathname
    : `/${locale}${pathname === '/' ? '' : pathname}`;
  return `${localizedPath}${search}`;
}

function correlatedResponse(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function nextResponse(request: NextRequest, requestId: string): NextResponse {
  return correlatedResponse(NextResponse.next({
    request: { headers: request.headers },
  }), requestId);
}

export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const correlatedHeaders = new Headers(request.headers);
  correlatedHeaders.set(REQUEST_ID_HEADER, requestId);
  const correlatedRequest = new NextRequest(request, { headers: correlatedHeaders });
  const { pathname } = correlatedRequest.nextUrl;
  const session = await getSessionState(correlatedRequest);
  const hasIdentity = session.authenticated || hasDemoIdentity(correlatedRequest);

  if (pathname.startsWith('/api/')) {
    if (isPublicApiPath(pathname)) return nextResponse(correlatedRequest, requestId);
    if (session.onboardingRequired && !pathname.startsWith('/api/onboarding/')) {
      return correlatedResponse(NextResponse.json({ error: 'ONBOARDING_REQUIRED' }, { status: 403 }), requestId);
    }
    if (hasIdentity) return nextResponse(correlatedRequest, requestId);
    return correlatedResponse(NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 }), requestId);
  }

  // API reference is intentionally locale-neutral and must bypass next-intl
  // rewriting so /api-docs resolves to its root App Router page.
  if (pathname === '/api-docs' || pathname.startsWith('/api-docs/')) {
    return nextResponse(correlatedRequest, requestId);
  }

  if (!isPublicPagePath(pathname) && !hasIdentity) {
    const locale = getLocale(pathname);
    const loginUrl = new URL(`/${locale}/login`, correlatedRequest.url);
    loginUrl.searchParams.set('callbackUrl', getLocalizedCallback(correlatedRequest, locale));
    return correlatedResponse(NextResponse.redirect(loginUrl), requestId);
  }

  if (
    session.onboardingRequired &&
    !isOnboardingAllowedPage(pathname)
  ) {
    const locale = getLocale(pathname);
    const onboardingUrl = new URL(`/${locale}/onboarding`, correlatedRequest.url);
    onboardingUrl.searchParams.set('callbackUrl', getLocalizedCallback(correlatedRequest, locale));
    return correlatedResponse(NextResponse.redirect(onboardingUrl), requestId);
  }

  return correlatedResponse(intlProxy(correlatedRequest), requestId);
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/api/:path*'],
};
