import { useTranslations } from 'next-intl';
import { Header } from '@/components/layout/header';

export default function OrgAdminPage() {
  const t = useTranslations('nav');

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('orgAdmin')}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Organization management console
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Members</h2>
            <p className="mt-1 text-sm text-zinc-500">Manage organization members and seats</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Usage</h2>
            <p className="mt-1 text-sm text-zinc-500">View organization quota and consumption</p>
          </div>
        </div>
      </main>
    </div>
  );
}
