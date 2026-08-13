const demoMode = process.env.DEMO_MODE === 'true';
const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
const smtpConfigured = Boolean(process.env.SMTP_HOST);

export const config = {
  runtime: {
    mode: (demoMode ? 'demo' : 'product') as 'demo' | 'product',
    demoMode,
    productMode: !demoMode,
  },
  auth: {
    enabled: true,
    googleEnabled: googleConfigured,
    emailOtpEnabled: smtpConfigured,
    passwordEnabled: true,
    providers: ['password', 'email', 'google'] as const,
  },
  db: {
    type: (process.env.DB_TYPE || 'sqlite') as 'postgresql' | 'sqlite',
  },
  i18n: {
    defaultLocale: 'zh' as const,
    locales: ['zh', 'en'] as const,
  },
};
