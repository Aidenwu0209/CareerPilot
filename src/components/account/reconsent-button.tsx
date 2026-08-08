'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function ReconsentButton() {
  const t = useTranslations('account.legal');
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleConsent = async () => {
    if (state === 'loading') return;
    setState('loading');
    try {
      const res = await fetch('/api/legal/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'explicit_reconsent' }),
      });
      if (!res.ok) throw new Error('CONSENT_FAILED');
      setState('success');
      router.refresh();
    } catch {
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        {t('reconsentSuccess')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleConsent}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
      >
        {state === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
        {state === 'loading' ? t('reconsenting') : t('reconsentButton')}
      </button>
      {state === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" />
          {t('reconsentFailed')}
        </div>
      )}
    </div>
  );
}
