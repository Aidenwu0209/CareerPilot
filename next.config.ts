import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'puppeteer-core', '@sparticuz/chromium-min'],
  experimental: {
    // Keep soft navigations and Server Actions pending while connectivity is
    // unavailable, then let Next.js retry them when the browser is online.
    useOffline: true,
  },
};

export default withNextIntl(nextConfig);
