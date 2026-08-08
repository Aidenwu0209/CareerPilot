import { getTranslations } from 'next-intl/server';

export default async function AdminOrganizationsPage() {
  const t = await getTranslations('admin');

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('sections.organizations.title')}
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t('sections.organizations.description')}
      </p>
    </div>
  );
}
