import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Header } from '@/components/layout/header';
import { CareerSubnav, type CareerNavItem } from '@/components/career/career-subnav';
import { CareerJourneyGuide, type CareerJourneyItem } from '@/components/career/career-journey-guide';

export default async function CareerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career' });
  const items: CareerNavItem[] = [
    { key: 'overview', href: '/career', label: t('subnav.overview') },
    { key: 'profile', href: '/career/profile', label: t('subnav.profile') },
    { key: 'assessment', href: '/career/assessment', label: t('subnav.assessment') },
    { key: 'goals', href: '/career/goals', label: t('subnav.goals') },
    { key: 'jobs', href: '/career/jobs', label: t('subnav.jobs') },
    { key: 'matching', href: '/career/matching', label: t('subnav.matching') },
    { key: 'path', href: '/career/path', label: t('subnav.path') },
    { key: 'report', href: '/career/report', label: t('subnav.report') },
  ];
  const journeyItems: CareerJourneyItem[] = [
    { href: '/career/assessment', label: t('journey.assessment.label'), description: t('journey.assessment.description'), tourKey: 'careerAssessment' },
    { href: '/career/goals', label: t('journey.goal.label'), description: t('journey.goal.description'), tourKey: 'careerGoal' },
    { href: '/career/matching', label: t('journey.match.label'), description: t('journey.match.description'), tourKey: 'careerMatch' },
    { href: '/career/path', label: t('journey.path.label'), description: t('journey.path.description'), tourKey: 'careerPath' },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <CareerSubnav items={items} label={t('subnav.label')} />
      <CareerJourneyGuide items={journeyItems} helpLabel={t('journey.help')} progressLabel={t('journey.progress')} />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
