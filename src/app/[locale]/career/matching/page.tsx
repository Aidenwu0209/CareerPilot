import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileQuestion,
  SearchCheck,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirectToLogin } from '@/lib/auth/login-redirect';
import { resolveServerContext } from '@/lib/auth/server-context';
import { getCareerMatch, getCareerOverview, listOccupations } from '@/lib/career/service';
import { Link } from '@/i18n/routing';
import type { CareerMatchBreakdownItem, CareerMatchResult } from '@/types/career';
import {
  CareerMetricCard,
  CareerPageHeader,
  CareerSection,
  EmptyCareerState,
  EvidenceBadge,
  StatusPill,
} from '@/components/career/career-shell';
import { MaterialSyncButton } from '@/components/career/material-sync-button';
import { MatchReviewFeedback } from '@/components/career/match-review-feedback';
import { CareerEvidenceSubmissionForm } from '@/components/career/career-evidence-submission-form';
import { MatchRecalculationButton } from '@/components/career/match-recalculation-button';
import { Button } from '@/components/ui/button';
import { JdMatchForm } from '@/components/career/jd-match-form';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function queryValues(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean);
}

function topStrengths(match: CareerMatchResult): CareerMatchBreakdownItem[] {
  const values = match.strengths?.length
    ? match.strengths
    : match.dimensionBreakdown.filter((item) => item.state === 'met');
  return values.slice(0, 3);
}

function topGaps(match: CareerMatchResult): CareerMatchBreakdownItem[] {
  const values = match.priorityGaps?.length
    ? match.priorityGaps
    : match.dimensionBreakdown
      .filter((item) => item.state !== 'met')
      .sort((a, b) => Number(b.requirement.required) - Number(a.requirement.required) || (b.gap ?? 0) - (a.gap ?? 0));
  return values.slice(0, 3);
}

function confidenceValue(match: CareerMatchResult): number | null {
  if (typeof match.confidence === 'number') return match.confidence;
  return match.totalWeight > 0 ? Math.round((match.knownWeight / match.totalWeight) * 100) : null;
}

function coverageValue(match: CareerMatchResult): number {
  return typeof match.knownCoverage === 'number'
    ? match.knownCoverage
    : match.totalWeight > 0
      ? Math.round((match.knownWeight / match.totalWeight) * 100)
      : 0;
}

function isNotEligible(match: CareerMatchResult): boolean {
  return (match.scoringStatus as string) === 'not_eligible' || match.dimensionBreakdown.length === 0;
}

function RequirementDetails({
  items,
  locale,
}: {
  items: CareerMatchBreakdownItem[];
  locale: string;
}) {
  return items.map((item) => {
    const StateIcon = item.state === 'met' ? CheckCircle2 : item.state === 'gap' ? AlertTriangle : FileQuestion;
    return (
      <details
        key={`${item.dimension}-${item.abilityCode}`}
        className="group rounded-lg border border-zinc-200 bg-white open:border-brand/30 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={
              item.state === 'met'
                ? 'mt-0.5 text-emerald-600 dark:text-emerald-300'
                : item.state === 'gap'
                  ? 'mt-0.5 text-amber-600 dark:text-amber-300'
                  : 'mt-0.5 text-zinc-400'
            }>
              <StateIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{item.abilityName}</h3>
                <StatusPill tone={item.state === 'met' ? 'positive' : item.state === 'gap' ? 'warning' : 'neutral'}>
                  {locale === 'zh' ? { met: '已满足', gap: '存在差距', unknown: '待补充' }[item.state] : { met: 'Met', gap: 'Gap', unknown: 'More evidence needed' }[item.state]}
                </StatusPill>
                <EvidenceBadge>{item.requirement.required ? (locale === 'zh' ? '必要能力' : 'Required') : (locale === 'zh' ? '加分能力' : 'Preferred')}</EvidenceBadge>
              </div>
              <p className="mt-1 text-sm leading-5 text-zinc-500 dark:text-zinc-400">{item.requirement.description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm tabular-nums">
            <span className="text-zinc-500 dark:text-zinc-400">
              {locale === 'zh' ? '当前' : 'Current'}：{item.studentScore === null ? (locale === 'zh' ? '未知' : 'Unknown') : item.studentScore}
            </span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {locale === 'zh' ? '目标' : 'Target'}：{item.requirement.targetScore}
            </span>
            <span className="text-zinc-400 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </div>
        </summary>

        <div className="grid gap-4 border-t border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/70 lg:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {locale === 'zh' ? '岗位要求' : 'Occupation requirement'}
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{item.requirement.description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {locale === 'zh' ? '能力证据' : 'Ability evidence'}
            </p>
            {item.studentEvidence.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {item.studentEvidence.map((evidence) => (
                  <li key={evidence.id} className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {evidence.title}
                      <StatusPill tone={evidence.status === 'verified' ? 'positive' : evidence.status === 'pending' ? 'warning' : 'neutral'}>
                        {locale === 'zh'
                          ? { pending: '待教师审核', verified: '已确认', rejected: '已退回' }[evidence.status]
                          : { pending: 'Teacher review pending', verified: 'Verified', rejected: 'Returned' }[evidence.status]}
                      </StatusPill>
                    </span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{evidence.excerpt}</span>
                    {evidence.sourceUrl ? (
                      <a
                        href={evidence.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        {locale === 'zh' ? '查看材料来源' : 'View evidence source'}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                    {typeof evidence.assessedScore === 'number' ? (
                      <span className="mt-1 block text-xs text-emerald-700 dark:text-emerald-300">
                        {locale === 'zh' ? `教师确认分：${evidence.assessedScore} / 100` : `Teacher-verified score: ${evidence.assessedScore} / 100`}
                        {evidence.reviewReason
                          ? locale === 'zh' ? ` · 审核理由：${evidence.reviewReason}` : ` · Review reason: ${evidence.reviewReason}`
                          : ''}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {locale === 'zh' ? '尚无可支持该能力的材料。' : 'No material currently supports this ability.'}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {locale === 'zh' ? '差距与行动' : 'Gap and action'}
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{item.action}</p>
            <p className="mt-2 text-xs font-medium text-brand">
              {item.gap === null
                ? locale === 'zh' ? '证据不足，暂不计算差距' : 'Insufficient evidence; gap not calculated'
                : item.gap > 0
                  ? locale === 'zh' ? `距离目标还差 ${item.gap} 分` : `${item.gap} points below the target`
                  : locale === 'zh' ? '当前证据已达到目标要求' : 'Current evidence meets the target'}
            </p>
          </div>
        </div>
      </details>
    );
  });
}

export default async function CareerMatchingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ occupationCode?: string | string[]; compare?: string | string[] }>;
}) {
  const [{ locale }, query, context] = await Promise.all([
    params,
    searchParams,
    resolveServerContext(),
  ]);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'career' });
  if (!context) return redirectToLogin('/career/matching');

  const [overview, occupations] = await Promise.all([
    getCareerOverview(context.actor.userId),
    listOccupations(),
  ]);
  const explicitCode = queryValue(query.occupationCode);
  const selectedCode = explicitCode ?? overview.primaryGoal?.occupationCode;
  const requestedComparison = queryValues(query.compare);
  const codes = selectedCode
    ? [...new Set([selectedCode, ...requestedComparison.filter((code) => code !== selectedCode)])].slice(0, 3)
    : [];
  const matches = codes.length > 0
    ? await Promise.all(codes.map((code) => getCareerMatch(context.actor.userId, code)))
    : [];
  const match = matches[0] ?? null;
  const matchableOccupations = occupations.filter((occupation) => occupation.scoringEligible === true);
  const selectedUnavailableOccupation = selectedCode && !matchableOccupations.some((item) => item.code === selectedCode)
    ? occupations.find((occupation) => occupation.code === selectedCode) ?? match?.occupation ?? null
    : null;
  const canSubmitEvidence = Boolean(
    match
    && overview.primaryGoal?.occupationCode === match.occupation.code
    && !isNotEligible(match),
  );
  const evidenceRequirements = match?.dimensionBreakdown.map((item) => ({
    abilityCode: item.abilityCode,
    abilityName: item.abilityName,
    required: item.requirement.required,
    description: item.requirement.description,
  })) ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <Breadcrumbs items={[
        { label: t('subnav.overview'), href: '/career' },
        { label: t('subnav.matching') },
      ]} />
      <CareerPageHeader
        eyebrow={t('matching.eyebrow')}
        title={t('matching.title')}
        description={t('matching.description')}
        action={match ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canSubmitEvidence ? (
              <CareerEvidenceSubmissionForm
                occupationCode={match.occupation.code}
                occupationName={match.occupation.name}
                requirements={evidenceRequirements}
              />
            ) : null}
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`/career/jobs/${match.occupation.code}`}>{t('matching.viewOccupation')}</Link>
            </Button>
          </div>
        ) : undefined}
      />

      <div role="note" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <p className="font-semibold">{t('matching.disclaimer.title')}</p>
        <p className="mt-1">{t('matching.disclaimer.description')}</p>
      </div>

      <JdMatchForm />

      <form method="get" className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
        <fieldset>
          <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('matching.compareForm.legend')}</legend>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('matching.compareForm.help')}</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('matching.compareForm.primary')}
              <select
                name="occupationCode"
                defaultValue={selectedCode ?? ''}
                required
                className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:text-zinc-100"
              >
                <option value="">{t('matching.selectPlaceholder')}</option>
                {selectedUnavailableOccupation ? (
                  <option value={selectedUnavailableOccupation.code} disabled>
                    {selectedUnavailableOccupation.name} · {t('common.knowledgePendingReview')}
                  </option>
                ) : null}
                {matchableOccupations.map((occupation) => (
                  <option key={occupation.code} value={occupation.code}>
                    {occupation.name} · {occupation.category}
                  </option>
                ))}
              </select>
            </label>
            {[0, 1].map((index) => (
              <label key={index} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {t('matching.compareForm.comparison', { number: index + 1 })}
                <select
                  name="compare"
                  defaultValue={requestedComparison[index] ?? ''}
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:text-zinc-100"
                >
                  <option value="">{t('matching.compareForm.none')}</option>
                  {matchableOccupations.map((occupation) => (
                    <option key={occupation.code} value={occupation.code}>
                      {occupation.name} · {occupation.category}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <MatchRecalculationButton
            label={t('matching.recalculate')}
            pendingLabel={t('matching.recalculating')}
            errorLabel={t('matching.recalculateError')}
          />
        </fieldset>
      </form>

      {!match ? (
        <EmptyCareerState
          icon={Target}
          title={t('matching.noGoal.title')}
          description={t('matching.noGoal.description')}
          href="/career/goals"
          actionLabel={t('matching.noGoal.action')}
        />
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 p-5 text-white dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={overview.primaryGoal?.occupationCode === match.occupation.code ? 'positive' : 'neutral'}>
                    {overview.primaryGoal?.occupationCode === match.occupation.code ? t('matching.primaryGoal') : t('matching.comparison')}
                  </StatusPill>
                  {match.catalogVersion ? <span className="text-xs text-zinc-400">{t('matching.catalogVersion', { version: match.catalogVersion })}</span> : null}
                </div>
                <h2 className="mt-3 text-2xl font-semibold">{match.occupation.name}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{match.occupation.summary}</p>
              </div>
              <div className="shrink-0 text-left sm:text-right">
                <p className="text-xs text-zinc-400">{t('metrics.match')}</p>
                <p className="mt-1 text-4xl font-bold tabular-nums">
                  {match.score === null
                    ? isNotEligible(match) ? t('common.knowledgePendingReview') : t('common.notScored')
                    : `${match.score}%`}
                </p>
              </div>
            </div>
          </section>

          {isNotEligible(match) ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30 sm:p-6" aria-labelledby="knowledge-review-title">
              <h2 id="knowledge-review-title" className="font-semibold text-amber-950 dark:text-amber-100">{t('matching.notEligible.title')}</h2>
              <p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">{t('matching.notEligible.description')}</p>
              <Button asChild variant="outline" className="mt-4"><Link href={`/career/jobs/${match.occupation.code}`}>{t('matching.viewOccupation')}</Link></Button>
            </section>
          ) : match.score === null ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30 sm:p-6" aria-labelledby="insufficient-evidence-title">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                    <FileQuestion className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 id="insufficient-evidence-title" className="font-semibold text-amber-950 dark:text-amber-100">{t('matching.insufficient.title')}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-amber-800 dark:text-amber-200">{t('matching.insufficient.description')}</p>
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      {t('matching.insufficient.coverage', {
                        known: coverageValue(match),
                        evidence: match.evidenceCoverage,
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <MaterialSyncButton />
                  <Button asChild variant="ghost" size="sm"><Link href="/career/profile">{t('matching.insufficient.viewProfile')}</Link></Button>
                </div>
              </div>
            </section>
          ) : null}

          <section aria-label={t('matching.metricsLabel')} className="grid gap-3 sm:grid-cols-3">
            <CareerMetricCard
              label={t('metrics.match')}
              value={match.score}
              suffix="%"
              description={t('metrics.matchDescription')}
              unknownLabel={isNotEligible(match) ? t('common.knowledgePendingReview') : t('common.notScored')}
              icon={Target}
            />
            <CareerMetricCard
              label={t('metrics.evidenceCoverage')}
              value={match.evidenceCoverage}
              suffix="%"
              description={t('metrics.evidenceCoverageDescription')}
              unknownLabel={t('common.insufficientEvidence')}
              icon={SearchCheck}
            />
            <CareerMetricCard
              label={t('matching.confidence')}
              value={confidenceValue(match)}
              suffix="%"
              description={t('matching.confidenceDescription')}
              unknownLabel={isNotEligible(match) ? t('common.knowledgePendingReview') : t('common.insufficientEvidence')}
              icon={ShieldCheck}
            />
          </section>

          {matches.length >= 2 ? (
            <CareerSection title={t('matching.comparisonTable.title')} description={t('matching.comparisonTable.description')}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-left text-sm">
                  <caption className="sr-only">{t('matching.comparisonTable.caption')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-zinc-200 p-3 text-zinc-500 dark:border-zinc-800">{t('matching.comparisonTable.dimension')}</th>
                      {matches.map((item) => <th key={item.occupation.code} scope="col" className="border-b border-zinc-200 p-3 text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">{item.occupation.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(['score', 'evidenceCoverage', 'confidence', 'strength', 'gap'] as const).map((field) => (
                      <tr key={field}>
                        <th scope="row" className="border-b border-zinc-100 p-3 font-medium text-zinc-500 dark:border-zinc-900">{t(`matching.comparisonTable.${field}`)}</th>
                        {matches.map((item) => {
                          const strength = topStrengths(item)[0]?.abilityName;
                          const gap = topGaps(item)[0]?.abilityName;
                          const pendingReview = isNotEligible(item);
                          const display = pendingReview && field !== 'evidenceCoverage'
                            ? t('common.knowledgePendingReview')
                            : field === 'score'
                              ? item.score === null ? t('common.notScored') : `${item.score}%`
                            : field === 'evidenceCoverage'
                              ? `${item.evidenceCoverage}%`
                              : field === 'confidence'
                                ? confidenceValue(item) === null ? t('common.insufficientEvidence') : `${confidenceValue(item)}%`
                                : field === 'strength' ? strength ?? t('common.insufficientEvidence') : gap ?? t('common.notSet');
                          return <td key={item.occupation.code} className="border-b border-zinc-100 p-3 text-zinc-700 dark:border-zinc-900 dark:text-zinc-300">{display}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CareerSection>
          ) : null}

          {!isNotEligible(match) ? <section aria-label={t('matching.summary.label')} className="grid gap-4 lg:grid-cols-3">
            <CareerSection title={t('matching.summary.strengths')} description={t('matching.summary.strengthsDescription')}>
              {topStrengths(match).length ? (
                <ol className="space-y-3">
                  {topStrengths(match).map((item, index) => (
                    <li key={item.abilityCode} className="flex gap-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{index + 1}</span>
                      <span><strong className="block text-zinc-900 dark:text-zinc-100">{item.abilityName}</strong>{item.studentEvidence[0]?.title ?? t('matching.summary.verifiedEvidence')}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('matching.summary.noStrengths')}</p>}
            </CareerSection>

            <CareerSection title={t('matching.summary.gaps')} description={t('matching.summary.gapsDescription')}>
              {topGaps(match).length ? (
                <ol className="space-y-3">
                  {topGaps(match).map((item, index) => (
                    <li key={item.abilityCode} className="flex gap-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">{index + 1}</span>
                      <span><strong className="block text-zinc-900 dark:text-zinc-100">{item.abilityName}</strong>{item.gap === null ? t('matching.breakdown.gapUnknown') : t('matching.breakdown.gapValue', { gap: item.gap })}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('matching.summary.noGaps')}</p>}
            </CareerSection>

            <CareerSection title={t('matching.summary.actions')} description={t('matching.summary.actionsDescription')}>
              {topGaps(match).length ? (
                <ol className="space-y-3">
                  {topGaps(match).map((item, index) => (
                    <li key={item.abilityCode} className="flex gap-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{index + 1}</span>
                      <span>{item.action}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('matching.summary.noActions')}</p>}
            </CareerSection>
          </section> : null}

          {match.changeSummary ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">{t('matching.change.title')}</p>
              <p className="mt-1 leading-6 text-zinc-500 dark:text-zinc-400">{match.changeSummary.reason}</p>
            </div>
          ) : null}

          {!isNotEligible(match) ? <CareerSection title={t('matching.breakdown.title')} description={t('matching.breakdown.description')}>
            <div className="space-y-6">
              {(['required', 'preferred'] as const).map((group) => {
                const items = match.dimensionBreakdown.filter((item) => item.requirement.required === (group === 'required'));
                if (!items.length) return null;
                return (
                  <section key={group} aria-labelledby={`requirements-${group}`}>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 id={`requirements-${group}`} className="font-semibold text-zinc-900 dark:text-zinc-100">{t(`matching.breakdown.${group}Title`)}</h3>
                      <StatusPill>{t('matching.breakdown.count', { count: items.length })}</StatusPill>
                    </div>
                    <div className="space-y-3"><RequirementDetails items={items} locale={locale} /></div>
                  </section>
                );
              })}
            </div>
          </CareerSection> : null}

          <CareerSection title={t('matching.sources.title')} description={t('matching.sources.description')}>
            {match.citations.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {match.citations.map((citation) => (
                  <a
                    key={citation.id}
                    href={citation.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-zinc-200 p-4 transition-colors hover:border-brand/30 hover:bg-brand/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:border-zinc-800 dark:hover:bg-brand/10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-800 dark:text-zinc-200">{citation.title}</p>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{citation.sourceLabel} · {formatDate(citation.verifiedAt, locale)}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{citation.excerpt}</p>
                  </a>
                ))}
              </div>
            ) : <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('jobDetail.sources.empty')}</p>}
          </CareerSection>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-zinc-400">{t('matching.generatedAt', { date: formatDate(match.generatedAt, locale) })}</p>
            <MatchReviewFeedback occupationCode={match.occupation.code} occupationName={match.occupation.name} />
          </div>
        </>
      )}
    </div>
  );
}
