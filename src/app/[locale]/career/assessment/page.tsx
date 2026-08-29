import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerSelfAssessment } from '@/lib/career/self-assessment-service';
import { CareerPageHeader } from '@/components/career/career-shell';
import { SelfAssessmentForm } from '@/components/career/self-assessment-form';
import { getCareerAccess } from '@/lib/career/growth-service';
import { getAssessmentHistory } from '@/lib/career/assessment-results';
import { Badge } from '@/components/ui/badge';
import { careerAssessmentResults } from '@/lib/db/schema';

export default async function CareerAssessmentPage({ params }: { params: Promise<{ locale: string }> }) {
  const [{ locale }, context] = await Promise.all([params, resolveServerContext()]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career.assessment' });
  if (!context) return redirectToLogin('/career/assessment');
  const [initial, access, history] = await Promise.all([
    getCareerSelfAssessment(context.actor.userId),
    getCareerAccess(context.actor.userId),
    getAssessmentHistory(context.actor.userId, 12),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <CareerPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <div role="note" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <p className="font-semibold">{t('noticeTitle')}</p>
        <p className="mt-1">{t('noticeDescription')}</p>
      </div>
      <SelfAssessmentForm initial={initial} locale={locale} access={access} />
      {history.length > 0 ? <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{locale === 'zh' ? '测评历史' : 'Assessment history'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{locale === 'zh' ? '每次完成都会保留 Holland、MBTI 与工作价值观结果，最新版本会用于人岗匹配。' : 'Each completion preserves Holland, MBTI, and work-values results; the latest version informs matching.'}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{history.map((item: typeof careerAssessmentResults.$inferSelect) => <article key={item.id} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2"><Badge variant="secondary">{{ holland: 'Holland', mbti: 'MBTI', work_values: locale === 'zh' ? '工作价值观' : 'Work values' }[item.assessmentType]}</Badge>{item.isLatest ? <Badge>{locale === 'zh' ? '最新' : 'Latest'}</Badge> : null}</div>
          <p className="mt-3 font-mono text-sm font-semibold">{item.resultCode || '—'}</p>
          <time className="mt-1 block text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(item.completedAt)}</time>
        </article>)}</div>
      </section> : null}
    </div>
  );
}
