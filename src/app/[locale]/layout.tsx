import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { SessionProvider } from 'next-auth/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { RuntimeConfigProvider } from '@/components/providers/runtime-config-provider';
import { BrandProvider } from '@/components/layout/brand-provider';
import { SettingsHydrator } from '@/components/providers/settings-hydrator';
import { config } from '@/lib/config';
import { NetworkStatusBanner } from '@/components/providers/network-status-banner';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return (
    <SessionProvider>
      <RuntimeConfigProvider
        mode={config.runtime.mode}
        googleEnabled={config.auth.googleEnabled}
      >
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <BrandProvider>
            <TooltipProvider>
              <SettingsHydrator />
              <NetworkStatusBanner />
              <a
                href="#main-content"
                className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:not-sr-only focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-white focus:shadow-lg"
              >
                {messages.common.skipToContent}
              </a>
              {children}
              <Toaster />
            </TooltipProvider>
          </BrandProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    </RuntimeConfigProvider>
    </SessionProvider>
  );
}
