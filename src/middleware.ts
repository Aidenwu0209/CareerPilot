import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// ---------------------------------------------------------------------------
// Public path definitions
// ---------------------------------------------------------------------------

// Public page paths (relative to locale prefix)
const PUBLIC_PAGE_PATHS = [
  '/',          // Landing page
  '/login',     // Login page
  '/privacy',   // Privacy policy
  '/terms',     // Terms of service
];

// Public API path prefixes — auth callbacks, OTP, health, public share reads.
// Anything NOT in this list requires a valid session cookie.
const PUBLIC_API_PREFIXES = [
  '/api/auth',     // NextAuth callbacks + OTP request/verify
  '/api/health',   // Health / readiness check
  '/api/share',    // Public share token reads
  '/api/webhooks/stripe', // Stripe signature is verified by the route
  '/api/internal', // Internal scheduler routes require CRON_SECRET bearer auth
];

function isPublicPagePath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(zh|en)/, '') || '/';
  return PUBLIC_PAGE_PATHS.some((p) =>
    p === '/' ? withoutLocale === '/' : withoutLocale.startsWith(p)
  );
}

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

function getSessionToken(request: NextRequest): string | undefined {
  return (
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value
  );
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authEnabled = process.env.AUTH_ENABLED === 'true';

  // ── API routes: enforce session cookie except for public whitelist ──
  if (pathname.startsWith('/api/')) {
    if (isPublicApiPath(pathname)) {
      return NextResponse.next();
    }

    // Fingerprint auth is a development-only mode. Individual route handlers
    // resolve and validate the X-Fingerprint header before touching user data.
    if (!authEnabled && process.env.NODE_ENV !== 'production') {
      return NextResponse.next();
    }

    const token = getSessionToken(request);
    if (!token) {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED' },
        { status: 401 },
      );
    }

    return NextResponse.next();
  }

  // ── Page routes: i18n + page-level auth ──
  const response = intlMiddleware(request);

  // Only check auth when OAuth is enabled
  if (!authEnabled) return response;

  if (isPublicPagePath(pathname)) return response;

  const token = getSessionToken(request);
  if (!token) {
    const localeMatch = pathname.match(/^\/(zh|en)/);
    const locale = localeMatch ? localeMatch[1] : 'zh';
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set(
      'callbackUrl',
      request.nextUrl.pathname + request.nextUrl.search,
    );
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/', '/login', '/(zh|en)/:path*', '/share/:path*', '/api/:path*'],
};
