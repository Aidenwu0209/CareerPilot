import { notFound } from 'next/navigation';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { DemoModeLogin } from '@/components/auth/demo-mode-login';
import { config } from '@/lib/config';

export default function DemoPage() {
  if (!config.runtime.demoMode) notFound();

  const t = useTranslations('auth.demo');
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <section className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <Image src="/logo.svg" alt="CareerPilot" width={160} height={36} priority />
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
