import { getTranslations } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { listOccupations } from '@/lib/career/service';
import { CareerPageHeader } from '@/components/career/career-shell';
import { OccupationBrowser, type CatalogOccupation } from '@/components/career/occupation-browser';

export default async function CareerJobsPage() {
  const [t, context] = await Promise.all([
    getTranslations('career'),
    resolveServerContext(),
  ]);
  if (!context) return redirectToLogin('/career/jobs');

  const occupations = await listOccupations();

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader
        eyebrow={t('jobs.eyebrow')}
        title={t('jobs.title')}
        description={t('jobs.description')}
      />

      <OccupationBrowser initialItems={occupations as CatalogOccupation[]} />
    </div>
  );
}
