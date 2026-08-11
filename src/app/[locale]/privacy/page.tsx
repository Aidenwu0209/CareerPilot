import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPage() {
  const t = useTranslations('legal.privacy');

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
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.intro.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.intro.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.collection.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.collection.body')}</p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm">
              <li>{t('sections.collection.items.account')}</li>
              <li>{t('sections.collection.items.resume')}</li>
              <li>{t('sections.collection.items.usage')}</li>
              <li>{t('sections.collection.items.cookies')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.use.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.use.body')}</p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm">
              <li>{t('sections.use.items.service')}</li>
              <li>{t('sections.use.items.ai')}</li>
              <li>{t('sections.use.items.security')}</li>
              <li>{t('sections.use.items.communication')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.sharing.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.sharing.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.retention.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.retention.body')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.rights.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.rights.body')}</p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm">
              <li>{t('sections.rights.items.access')}</li>
              <li>{t('sections.rights.items.export')}</li>
              <li>{t('sections.rights.items.delete')}</li>
              <li>{t('sections.rights.items.revoke')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('sections.security.title')}</h2>
            <p className="mt-3 text-sm">{t('sections.security.body')}</p>
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
