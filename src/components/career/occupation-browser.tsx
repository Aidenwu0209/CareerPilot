'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  GitCompareArrows,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyCareerState, StatusPill } from '@/components/career/career-shell';
import type { OccupationSummary } from '@/types/career';

type RelevanceType = 'primary' | 'adjacent' | 'cross_major' | 'stretch';

type MajorMapping = {
  majorCode: string;
  majorName: string;
  collegeCode: string;
  collegeName: string;
  relevanceType: RelevanceType;
};

export type CatalogOccupation = OccupationSummary & {
  jobFamily?: string | null;
  industry?: string | null;
  city?: string | null;
  educationLevel?: string | null;
  cities?: string[];
  educationLevels?: string[];
  catalogVersion?: string | null;
  relevanceType?: RelevanceType | null;
  aliases?: string[];
  majorCodes?: string[];
  majorMappings?: MajorMapping[];
  scoringEligible?: boolean;
};

type FilterOption = { value: string; label: string };
type CatalogFilters = Record<string, unknown>;

type CatalogResponse = {
  items?: CatalogOccupation[];
  occupations?: CatalogOccupation[];
  pageInfo?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  filters?: CatalogFilters;
};

const FILTER_FIELDS = [
  { field: 'collegeCode', responseKey: 'colleges' },
  { field: 'majorCode', responseKey: 'majors' },
  { field: 'jobFamily', responseKey: 'jobFamilies' },
  { field: 'industry', responseKey: 'industries' },
  { field: 'city', responseKey: 'cities' },
  { field: 'educationLevel', responseKey: 'educationLevels' },
  { field: 'relevanceType', responseKey: 'relevanceTypes', translationKey: 'relevanceType' },
  { field: 'relationType', responseKey: 'relationTypes', translationKey: 'relationType' },
] as const;

const PAGE_SIZE = 24;

function optionFromUnknown(value: unknown): FilterOption | null {
  if (typeof value === 'string' && value.trim()) return { value, label: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const optionValue = [item.value, item.code, item.id, item.name].find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  );
  if (typeof optionValue !== 'string') return null;
  const optionLabel = [item.label, item.name, item.title, item.value].find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  );
  return { value: optionValue, label: typeof optionLabel === 'string' ? optionLabel : optionValue };
}

export function normalizeFilterOptions(value: unknown): FilterOption[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, FilterOption>();
  for (const item of value) {
    const option = optionFromUnknown(item);
    if (option) unique.set(option.value, option);
  }
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function filterOptions(filters: CatalogFilters, field: string, responseKey: string): FilterOption[] {
  return normalizeFilterOptions(filters[responseKey] ?? filters[field]);
}

function matchComparisonHref(items: CatalogOccupation[]): string {
  const [primary, ...comparison] = items;
  const params = new URLSearchParams({ occupationCode: primary.code });
  comparison.forEach((item) => params.append('compare', item.code));
  return `/career/matching?${params.toString()}`;
}

export function OccupationBrowser({ initialItems }: { initialItems: CatalogOccupation[] }) {
  const t = useTranslations('career');
  const [items, setItems] = useState(initialItems);
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [values, setValues] = useState<Record<string, string>>({
    q: '',
    collegeCode: '',
    majorCode: '',
    jobFamily: '',
    industry: '',
    city: '',
    educationLevel: '',
    relevanceType: '',
    relationType: '',
  });
  const [pageInfo, setPageInfo] = useState({
    limit: PAGE_SIZE,
    offset: 0,
    total: initialItems.length,
    hasMore: false,
  });
  const [selected, setSelected] = useState<Map<string, CatalogOccupation>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const availableFilters = useMemo(() => FILTER_FIELDS.flatMap((definition) => {
    const options = filterOptions(filters, definition.field, definition.responseKey);
    return options.length > 0 ? [{ ...definition, options }] : [];
  }), [filters]);

  async function load(offset = 0, nextValues = values) {
    setIsLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      Object.entries(nextValues).forEach(([key, value]) => {
        if (value.trim()) params.set(key, value.trim());
      });
      const response = await fetch(`/api/career/occupations?${params.toString()}`);
      if (!response.ok) throw new Error('catalog_request_failed');
      const body = (await response.json()) as CatalogResponse;
      const nextItems = body.items ?? body.occupations ?? [];
      setItems(nextItems);
      setFilters(body.filters ?? {});
      setPageInfo(body.pageInfo ?? {
        limit: PAGE_SIZE,
        offset,
        total: nextItems.length,
        hasMore: false,
      });
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load(0);
    // Initial catalog hydration should run once; subsequent loads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateValue(field: string, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    const empty = Object.fromEntries(Object.keys(values).map((key) => [key, '']));
    setValues(empty);
    void load(0, empty);
  }

  function toggleComparison(item: CatalogOccupation) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.code)) next.delete(item.code);
      else if (next.size < 3) next.set(item.code, item);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void load(0);
        }}
        className="rounded-xl border border-zinc-200 bg-white p-4 shadow-none dark:border-zinc-800 dark:bg-zinc-950 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1" htmlFor="occupation-search">
            <span className="mb-2 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {t('jobs.searchLabel')}
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <Input
                id="occupation-search"
                type="search"
                value={values.q}
                onChange={(event) => updateValue('q', event.target.value)}
                placeholder={t('jobs.searchPlaceholder')}
                className="h-10 bg-white pl-9 dark:bg-zinc-950"
              />
            </span>
          </label>
          <Button type="submit" disabled={isLoading} className="bg-brand hover:bg-brand-hover">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {t('jobs.searchAction')}
          </Button>
        </div>

        {availableFilters.length > 0 ? <fieldset className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <legend className="flex items-center gap-2 pr-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {t('jobs.filters.title')}
          </legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {availableFilters.map(({ field, options, ...definition }) => {
              return (
                <label key={field} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {t(`jobs.filters.${field}`)}
                  <select
                    value={values[field]}
                    onChange={(event) => updateValue(field, event.target.value)}
                    className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:text-zinc-100"
                  >
                    <option value="">{t('jobs.filters.all')}</option>
                    {options.map((option) => {
                      const translationKey = 'translationKey' in definition ? definition.translationKey : null;
                      const labelKey = translationKey ? `${translationKey}.${option.value}` : null;
                      return (
                        <option key={option.value} value={option.value}>
                          {labelKey && t.has(labelKey) ? t(labelKey) : option.label}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} disabled={isLoading}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t('jobs.filters.reset')}
            </Button>
          </div>
        </fieldset> : null}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('jobs.resultCount', { count: pageInfo.total })}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('jobs.compare.help', { count: selectedItems.length })}
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t('jobs.loadFailed')}
          <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => void load(pageInfo.offset)}>
            {t('error.retry')}
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section aria-label={t('jobs.listLabel')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((occupation) => {
            const isSelected = selected.has(occupation.code);
            return (
              <Card key={occupation.code} className="group gap-5 py-5 shadow-none transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md">
                <CardHeader className="px-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                      <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
                    </span>
                    {occupation.scoringEligible === false ? (
                      <StatusPill tone="warning">{t('common.knowledgePendingReview')}</StatusPill>
                    ) : occupation.matchScore === null ? (
                      <StatusPill tone="warning">{t('common.notScored')}</StatusPill>
                    ) : (
                      <StatusPill tone="positive">{t('jobs.matchScore', { score: occupation.matchScore })}</StatusPill>
                    )}
                  </div>
                  <div className="mt-1">
                    <CardTitle className="text-lg">{occupation.name}</CardTitle>
                    <CardDescription className="mt-1">{occupation.category}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {occupation.jobFamily ? <StatusPill>{occupation.jobFamily}</StatusPill> : null}
                    {occupation.industry ? <StatusPill>{occupation.industry}</StatusPill> : null}
                    {(occupation.cities?.[0] ?? occupation.city) ? <StatusPill>{occupation.cities?.[0] ?? occupation.city}</StatusPill> : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col px-5">
                  <p className="line-clamp-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{occupation.summary}</p>
                  {occupation.majorMappings?.length ? (
                    <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      {t('jobs.relatedMajors', {
                        majors: occupation.majorMappings.slice(0, 2).map((mapping) => mapping.majorName).join(t('jobs.separator')),
                      })}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <Button asChild variant="ghost" className="-ml-3 w-fit text-brand hover:text-brand">
                      <Link href={`/career/jobs/${occupation.code}`}>
                        {t('jobs.viewOccupation')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                    <label className={`inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm ${occupation.scoringEligible === false ? 'cursor-not-allowed text-zinc-400 dark:text-zinc-600' : 'cursor-pointer text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={occupation.scoringEligible === false || (!isSelected && selected.size >= 3)}
                        onChange={() => toggleComparison(occupation)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      {occupation.scoringEligible === false ? t('jobs.compare.pendingReview') : t('jobs.compare.select')}
                    </label>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : !isLoading ? (
        <EmptyCareerState
          icon={Search}
          title={t('jobs.empty.title')}
          description={t('jobs.empty.description')}
          actionLabel={t('jobs.filters.reset')}
          onAction={resetFilters}
        />
      ) : null}

      {selectedItems.length > 0 ? (
        <section aria-labelledby="occupation-comparison-title" className="rounded-xl border border-brand/20 bg-brand/5 p-4 dark:bg-brand/10 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="occupation-comparison-title" className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                <GitCompareArrows className="h-5 w-5 text-brand" aria-hidden="true" />
                {t('jobs.compare.title')}
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('jobs.compare.description')}</p>
            </div>
            {selectedItems.length >= 2 ? (
              <Button asChild className="bg-brand hover:bg-brand-hover">
                <Link href={matchComparisonHref(selectedItems)}>{t('jobs.compare.action')}</Link>
              </Button>
            ) : (
              <Button type="button" disabled>{t('jobs.compare.action')}</Button>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">{t('jobs.compare.tableCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-zinc-200 p-3 text-zinc-500 dark:border-zinc-800">{t('jobs.compare.dimension')}</th>
                  {selectedItems.map((item) => <th key={item.code} scope="col" className="border-b border-zinc-200 p-3 text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">{item.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {(['jobFamily', 'industry', 'city', 'educationLevel', 'matchScore'] as const).map((field) => (
                  <tr key={field}>
                    <th scope="row" className="border-b border-zinc-100 p-3 font-medium text-zinc-500 dark:border-zinc-900">{t(`jobs.compare.${field}`)}</th>
                    {selectedItems.map((item) => (
                      <td key={item.code} className="border-b border-zinc-100 p-3 text-zinc-700 dark:border-zinc-900 dark:text-zinc-300">
                        {field === 'matchScore'
                          ? item.matchScore === null ? t('common.notScored') : `${item.matchScore}%`
                          : field === 'city'
                            ? item.cities?.join(t('jobs.separator')) || item.city || t('common.notSet')
                            : field === 'educationLevel'
                              ? item.educationLevels?.join(t('jobs.separator')) || item.educationLevel || t('common.notSet')
                              : item[field] || t('common.notSet')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <nav aria-label={t('jobs.pagination.label')} className="flex items-center justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          disabled={isLoading || pageInfo.offset === 0}
          onClick={() => void load(Math.max(0, pageInfo.offset - pageInfo.limit))}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('jobs.pagination.previous')}
        </Button>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {t('jobs.pagination.status', {
            start: pageInfo.total === 0 ? 0 : pageInfo.offset + 1,
            end: Math.min(pageInfo.total, pageInfo.offset + items.length),
            total: pageInfo.total,
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={isLoading || !pageInfo.hasMore}
          onClick={() => void load(pageInfo.offset + pageInfo.limit)}
        >
          {t('jobs.pagination.next')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
