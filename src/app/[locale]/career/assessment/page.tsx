import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerSelfAssessment } from '@/lib/career/self-assessment-service';
import { CareerPageHeader } from '@/components/career/career-shell';
import { SelfAssessmentForm } from '@/components/career/self-assessment-form';

export default async function CareerAssessmentPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, context] = await Promise.all([params, resolveServerContext()]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career.assessment' });
  if (!context) return redirectToLogin('/career/assessment');
  const initial = await getCareerSelfAssessment(context.actor.userId);

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div role="note" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <p className="font-semibold">{t('noticeTitle')}</p>
        <p className="mt-1">{t('noticeDescription')}</p>
      </div>
      <SelfAssessmentForm initial={initial} locale={locale} />
    </div>
  );
}
