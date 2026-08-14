'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InterviewerBanner } from './interviewer-banner';
import type { InterviewerConfig } from '@/types/interview';
import { CheckCircle2 } from 'lucide-react';

interface RoundTransitionProps {
  nextInterviewer: InterviewerConfig;
  onContinue: () => void;
  isLastRound?: boolean;
}

export function RoundTransition({ nextInterviewer, onContinue, isLastRound }: RoundTransitionProps) {
  const t = useTranslations('interview.room');

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      <div className="celebration-pop flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        <CheckCircle2 className="size-9" aria-hidden="true" />
      </div>
      <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
        {isLastRound ? t('allComplete') : t('roundComplete')}
      </p>
      {!isLastRound && (
        <>
          <div className="w-full max-w-md px-4">
            <InterviewerBanner config={nextInterviewer} questionCount={0} />
          </div>
          <Button onClick={onContinue} size="lg">
            {t('nextRound')}
          </Button>
        </>
      )}
      {isLastRound && (
        <Button onClick={onContinue} size="lg">
          {t('generateReport')}
        </Button>
      )}
    </div>
  );
}
