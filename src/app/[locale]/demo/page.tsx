import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DemoModeLogin } from '@/components/auth/demo-mode-login';
import { config } from '@/lib/config';
import { CareerPilotLogo } from '@/components/layout/careerpilot-logo';

export default function DemoPage() {
  if (!config.runtime.demoMode) notFound();

  const t = useTranslations('auth.demo');
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <section className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <CareerPilotLogo preload />
        <h1 className="mt-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          {t('pageTitle')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {t('pageDescription')}
        </p>
        <div className="mt-6">
          <DemoModeLogin />
        </div>
      </section>
    </main>
  );
}
