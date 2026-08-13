import { useTranslations } from 'next-intl';
import { ArrowRight, FileCheck2, Route, Target } from 'lucide-react';

const STEPS = [
  { key: 'evidence', icon: FileCheck2 },
  { key: 'target', icon: Target },
  { key: 'growth', icon: Route },
] as const;

export function CareerJourneySection() {
  const t = useTranslations('landing.journey');

  return (
    <section id="journey" className="px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.4fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">{t('eyebrow')}</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">{t('title')}</h2>
            <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              {t('standard')}
            </div>
          </div>

          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map(({ key, icon: Icon }, index) => (
              <li key={key} className="relative rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-muted text-brand">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold text-zinc-400">0{index + 1}</span>
                </div>
                <h3 className="mt-5 font-semibold text-zinc-900 dark:text-zinc-100">{t(`steps.${key}.title`)}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{t(`steps.${key}.description`)}</p>
                {index < STEPS.length - 1 && (
                  <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white text-zinc-300 sm:block dark:bg-zinc-950 dark:text-zinc-700" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
