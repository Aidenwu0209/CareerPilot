'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function CareerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('career');

  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('error.title')}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('error.description')}</p>
      <Button type="button" variant="outline" onClick={reset} className="mt-5">
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {t('error.retry')}
      </Button>
    </div>
  );
}
