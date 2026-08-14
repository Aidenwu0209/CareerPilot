import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { HelpCenter } from '@/components/support/help-center';

export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'help' });
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <div className="mb-8 max-w-3xl">
          <p className="text-sm font-semibold text-brand">{t('eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{t('title')}</h1>
          <p className="mt-3 leading-7 text-zinc-600 dark:text-zinc-400">{t('description')}</p>
        </div>
        <Suspense fallback={null}><HelpCenter /></Suspense>
      </main>
    </div>
  );
}
