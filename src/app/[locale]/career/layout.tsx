import { getTranslations } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { CareerSubnav, type CareerNavItem } from '@/components/career/career-subnav';

export default async function CareerLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('career');
  const items: CareerNavItem[] = [
    { key: 'overview', href: '/career', label: t('subnav.overview') },
    { key: 'profile', href: '/career/profile', label: t('subnav.profile') },
    { key: 'goals', href: '/career/goals', label: t('subnav.goals') },
    { key: 'jobs', href: '/career/jobs', label: t('subnav.jobs') },
    { key: 'matching', href: '/career/matching', label: t('subnav.matching') },
    { key: 'path', href: '/career/path', label: t('subnav.path') },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <CareerSubnav items={items} label={t('subnav.label')} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
