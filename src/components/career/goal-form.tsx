'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import type { CareerGoal, OccupationSummary } from '@/types/career';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fetchJson } from '@/lib/http/client';
import { TagInput, normalizeTags } from '@/components/ui/tag-input';

const DRAFT_KEY = 'careerpilot:career-goal-draft';

function draftTags(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeTags(value.filter((item): item is string => typeof item === 'string'));
  if (typeof value === 'string') return normalizeTags(value.split(/[,，、\n]/));
  return [];
}

export function GoalForm({
  occupations,
  currentGoal,
}: {
  occupations: OccupationSummary[];
  currentGoal: CareerGoal | null;
}) {
  const t = useTranslations('career');
  const router = useRouter();
  const scoreableOccupations = occupations.filter((occupation) => occupation.scoringEligible === true);
  const currentGoalIsUnavailable = Boolean(
    currentGoal && !scoreableOccupations.some((occupation) => occupation.code === currentGoal.occupationCode),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [occupationError, setOccupationError] = useState('');
  const [occupationCode, setOccupationCode] = useState(
    currentGoal && !currentGoalIsUnavailable ? currentGoal.occupationCode : '',
  );
  const [targetDate, setTargetDate] = useState(currentGoal?.targetDate?.slice(0, 10) ?? '');
  const [rationale, setRationale] = useState(currentGoal?.rationale ?? '');
  const [industries, setIndustries] = useState(currentGoal?.preferences.industries ?? []);
  const [cities, setCities] = useState(currentGoal?.preferences.cities ?? []);
  const [organizationTypes, setOrganizationTypes] = useState(
    currentGoal?.preferences.organizationTypes ?? [],
  );
  const industrySuggestions = normalizeTags(scoreableOccupations.flatMap((occupation) => occupation.industry ? [occupation.industry] : []));
  const citySuggestions = normalizeTags(scoreableOccupations.flatMap((occupation) => occupation.cities ?? []));
  const organizationTypeSuggestions = t.raw('goals.form.organizationTypeSuggestions') as string[];

  useEffect(() => {
    if (currentGoal) return;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      setOccupationCode(typeof draft.occupationCode === 'string' ? draft.occupationCode : '');
      setTargetDate(typeof draft.targetDate === 'string' ? draft.targetDate : '');
      setRationale(typeof draft.rationale === 'string' ? draft.rationale : '');
      setIndustries(draftTags(draft.industries));
      setCities(draftTags(draft.cities));
      setOrganizationTypes(draftTags(draft.organizationTypes));
    } catch { localStorage.removeItem(DRAFT_KEY); }
  }, [currentGoal]);

  useEffect(() => {
    if (currentGoal) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ occupationCode, targetDate, rationale, industries, cities, organizationTypes }));
  }, [currentGoal, occupationCode, targetDate, rationale, industries, cities, organizationTypes]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!occupationCode) {
      setOccupationError(t('goals.form.errors.occupationRequired'));
      return;
    }

    setIsSaving(true);
    try {
      await fetchJson('/api/career/goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occupationCode,
          isPrimary: true,
          targetDate: targetDate || null,
          rationale: rationale.trim(),
          preferences: {
            industries,
            cities,
            organizationTypes,
          },
        }),
      });
      localStorage.removeItem(DRAFT_KEY);
      toast.success(t('goals.form.saved'));
      router.refresh();
    } catch {
      toast.error(t('goals.form.errors.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="career-occupation">{t('goals.form.occupation')}</Label>
        <select
          id="career-occupation"
          name="occupationCode"
          value={occupationCode}
          onChange={(event) => {
            setOccupationCode(event.target.value);
            if (event.target.value) setOccupationError('');
          }}
          onBlur={() => setOccupationError(occupationCode ? '' : t('goals.form.errors.occupationRequired'))}
          aria-invalid={Boolean(occupationError)}
          aria-describedby={occupationError ? 'career-occupation-error' : undefined}
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:text-zinc-100"
        >
          <option value="">{t('goals.form.occupationPlaceholder')}</option>
          {scoreableOccupations.map((occupation) => (
            <option key={occupation.code} value={occupation.code}>
              {occupation.name} · {occupation.category}
            </option>
          ))}
        </select>
        {occupationError && <p id="career-occupation-error" role="alert" className="text-sm text-red-600 dark:text-red-400">{occupationError}</p>}
        {currentGoalIsUnavailable ? (
          <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {t('goals.form.currentGoalUnavailable', { occupation: currentGoal!.occupationName })}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('goals.form.occupationHelp')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="career-target-date">{t('goals.form.targetDate')}</Label>
        <Input
          id="career-target-date"
          name="targetDate"
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="career-rationale">{t('goals.form.rationale')}</Label>
        <Textarea
          id="career-rationale"
          name="rationale"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder={t('goals.form.rationalePlaceholder')}
          rows={4}
        />
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('goals.form.rationaleHelp')}</p>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('goals.form.preferences')}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="career-industries">{t('goals.form.industries')}</Label>
            <TagInput
              id="career-industries"
              value={industries}
              onChange={setIndustries}
              suggestions={industrySuggestions}
              ariaLabel={t('goals.form.industries')}
              removeLabel={(tag) => t('goals.form.removePreference', { tag })}
              placeholder={t('goals.form.commaSeparated')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="career-cities">{t('goals.form.cities')}</Label>
            <TagInput
              id="career-cities"
              value={cities}
              onChange={setCities}
              suggestions={citySuggestions}
              ariaLabel={t('goals.form.cities')}
              removeLabel={(tag) => t('goals.form.removePreference', { tag })}
              placeholder={t('goals.form.commaSeparated')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="career-organization-types">{t('goals.form.organizationTypes')}</Label>
            <TagInput
              id="career-organization-types"
              value={organizationTypes}
              onChange={setOrganizationTypes}
              suggestions={organizationTypeSuggestions}
              ariaLabel={t('goals.form.organizationTypes')}
              removeLabel={(tag) => t('goals.form.removePreference', { tag })}
              placeholder={t('goals.form.commaSeparated')}
            />
          </div>
        </div>
      </fieldset>

      <Button type="submit" disabled={isSaving || scoreableOccupations.length === 0} className="w-full bg-brand hover:bg-brand-hover sm:w-auto">
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        {isSaving ? t('goals.form.saving') : currentGoal ? t('goals.form.update') : t('goals.form.create')}
      </Button>
    </form>
  );
}
