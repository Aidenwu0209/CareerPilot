import { getTranslations } from 'next-intl/server';

export default async function OrgAdminUsagePage() {
  const t = await getTranslations('orgAdmin');

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('sections.usage.title')}
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t('sections.usage.description')}
      </p>
    </div>
  );
}
