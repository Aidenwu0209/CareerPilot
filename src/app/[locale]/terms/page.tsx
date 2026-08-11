import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  const t = useTranslations('legal.terms');

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Link>

        <h1 className="mt-8 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t('version')}: {t('versionNumber')} · {t('effectiveDate')}
        </p>

        <div className="mt-10 space-y-8 leading-relaxed text-zinc-700 dark:text-zinc-300">
          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.acceptance.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.acceptance.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.accounts.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.accounts.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.credits.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.credits.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.ai.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.ai.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.orgUsage.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.orgUsage.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.prohibited.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.prohibited.body')}</p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm">
              <li>{t('sections.prohibited.items.abuse')}</li>
              <li>{t('sections.prohibited.items.reverse')}</li>
              <li>{t('sections.prohibited.items.unauthorized')}</li>
              <li>{t('sections.prohibited.items.illegal')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.disclaimer.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.disclaimer.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.liability.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.liability.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.changes.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.changes.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.contact.title')}</h2>
            <p className="mt-3 text-sm">
              {t.rich('sections.contact.body', {
                email: () => (
                  <a href="mailto:support@careerpilot.app" className="text-brand underline hover:no-underline">
                    support@careerpilot.app
                  </a>
                ),
              })}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
