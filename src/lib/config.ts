const demoMode = process.env.DEMO_MODE === 'true';
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const config = {
  runtime: {
    mode: (demoMode ? 'demo' : 'product') as 'demo' | 'product',
    demoMode,
    productMode: !demoMode,
  },
  auth: {
    enabled: true,
    googleEnabled: googleConfigured,
    providers: ['google'] as const,
  },
  db: {
    type: (process.env.DB_TYPE || 'sqlite') as 'postgresql' | 'sqlite',
  },
  i18n: {
    defaultLocale: 'zh' as const,
    locales: ['zh', 'en'] as const,
  },
};
