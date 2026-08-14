'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JDInput } from './jd-input';
import { ResumeSelector } from './resume-selector';
import { InterviewerPicker } from './interviewer-picker';
import { useRouter } from '@/i18n/routing';
import type { InterviewerConfig, InterviewSession } from '@/types/interview';
import { AlertCircle, Mic } from 'lucide-react';
import { readJsonResponse } from '@/lib/http/json-client';
import { getFriendlyApiErrorKey, type FriendlyApiErrorKey } from '@/lib/http/error-messages';
import { useLocalStorageDraft } from '@/hooks/use-local-storage-draft';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const DRAFT_KEY = 'careerpilot:interview-setup-draft';

type InterviewSetupDraft = {
  title: string;
  jd: string;
  resumeId?: string;
  selectedInterviewers: InterviewerConfig[];
};

export function InterviewSetup() {
  const t = useTranslations('interview.setup');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const validateDraft = useCallback((value: unknown): value is InterviewSetupDraft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Record<string, unknown>;
    return typeof draft.title === 'string'
      && typeof draft.jd === 'string'
      && (draft.resumeId == null || typeof draft.resumeId === 'string')
      && Array.isArray(draft.selectedInterviewers);
  }, []);
  const draft = useLocalStorageDraft<InterviewSetupDraft>(
    DRAFT_KEY,
    { title: '', jd: '', selectedInterviewers: [] },
    validateDraft,
  );
  const { title, jd, resumeId, selectedInterviewers } = draft.value;
  const updateDraft = (updates: Partial<InterviewSetupDraft>) => {
    draft.setValue((current) => ({ ...current, ...updates }));
  };
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<FriendlyApiErrorKey | null>(null);

  const canStart = jd.trim().length > 0 && selectedInterviewers.length > 0;

  const handleStart = async () => {
    if (!canStart) return;
    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobDescription: jd,
          jobTitle: title.trim() || jd.split('\n')[0].slice(0, 100) || 'Interview',
          resumeId,
          interviewers: selectedInterviewers,
        }),
      });

      const { session } = await readJsonResponse<{ session: InterviewSession }>(res);
      draft.clear();
      router.push(`/interview/${session.id}`);
    } catch (err) {
      console.error('Failed to create interview:', err);
      setCreateError(getFriendlyApiErrorKey(err, navigator.onLine));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 rounded-xl bg-gradient-to-r from-brand-muted to-white px-6 py-5 dark:from-brand-muted/30 dark:to-zinc-900">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Mic className="h-5 w-5 text-brand" aria-hidden="true" />
          {t('title')}
        </h1>
      </div>
      <div className="space-y-6 px-1">
        {draft.restored && (
          <p role="status" className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
            {t('draftRestored')}
          </p>
        )}
        {/* Title input */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand text-[10px] font-bold text-white">0</span>
            {t('titleLabel')}
          </div>
          <Input
            value={title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            placeholder={t('titlePlaceholder')}
            className="rounded-xl"
          />
        </div>
        <JDInput value={jd} onChange={(value) => updateDraft({ jd: value })} />
        <ResumeSelector value={resumeId} onChange={(value) => updateDraft({ resumeId: value })} />
        <InterviewerPicker selected={selectedInterviewers} onChange={(value) => updateDraft({ selectedInterviewers: value })} />
      </div>
      <div className="mt-8 px-1">
        {createError && (
          <p role="alert" className="mb-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {tErrors(createError)}
          </p>
        )}
        <Button
          onClick={handleStart}
          disabled={!canStart || isCreating}
          className="w-full rounded-xl bg-gradient-to-r from-brand to-brand-hover py-6 text-base font-semibold hover:from-brand-hover hover:to-brand-hover"
          size="lg"
        >
          {isCreating ? '...' : t('startInterview')}
        </Button>
      </div>
    </div>
  );
}
