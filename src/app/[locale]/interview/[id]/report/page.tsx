'use client';

import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { InterviewReportView } from '@/components/interview/interview-report';
import { Skeleton } from '@/components/ui/skeleton';
import { useCredits } from '@/hooks/use-credits';
import { readJsonResponse } from '@/lib/http/json-client';
import type { InterviewReport, InterviewSession } from '@/types/interview';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export default function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('interview.report');
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);

  const { refresh: refreshBalance } = useCredits();

  useEffect(() => {
    fetch(`/api/interview/${id}`, { headers: JSON_HEADERS })
      .then((response) => readJsonResponse<{
        session: InterviewSession;
        report: InterviewReport | null;
      }>(response))
      .then(({ session: s, report: r }) => {
        setSession(s);
        if (r) {
          setReport(r);
          setLoading(false);
        } else {
          fetch(`/api/interview/${id}/report`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ locale: document.documentElement.lang || 'zh' }),
          })
            .then((response) => readJsonResponse<InterviewReport>(response))
            .then((data) => {
              setReport(data);
              refreshBalance();
            })
            .catch((err) => {
              console.error(err);
              const msg = err.message || '';
              if (msg.includes('INSUFFICIENT_CREDITS')) {
                toast.error(t('insufficientCredits'));
              } else if (msg.includes('RATE_LIMITED')) {
                toast.error(t('rateLimited'));
              } else if (msg.includes('MODEL_NOT_ALLOWED')) {
                toast.error(t('modelNotAllowed'));
              } else if (msg.includes('ACCOUNT_SUSPENDED')) {
                toast.error(t('accountSuspended'));
              } else {
                toast.error(t('reportFailed'));
              }
            })
            .finally(() => setLoading(false));
        }
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [id, t, refreshBalance]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!report || !session) {
    return <div className="py-20 text-center text-zinc-500">Failed to load report</div>;
  }

  return <InterviewReportView report={report} session={session} />;
}
