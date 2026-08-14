import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminSupportManager } from '@/components/admin/admin-support-manager';

export default async function AdminSupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin.sections.support' });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('description')}</p>
      </div>
      <AdminSupportManager />
    </div>
  );
}
