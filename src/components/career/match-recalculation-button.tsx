'use client';

import { useState } from 'react';
import { GitCompareArrows, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function MatchRecalculationButton({
  label,
  pendingLabel,
  errorLabel,
}: {
  label: string;
  pendingLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function recalculate(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest('form');
    if (!form?.reportValidity()) return;
    const data = new FormData(form);
    const occupationCode = String(data.get('occupationCode') ?? '').trim();
    if (!occupationCode) return;

    setPending(true);
    setError(false);
    try {
      const response = await fetch('/api/career/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupationCode }),
      });
      if (!response.ok) throw new Error('match_recalculation_failed');

      const params = new URLSearchParams({ occupationCode });
      data.getAll('compare').map(String).filter((code) => code && code !== occupationCode).slice(0, 2)
        .forEach((code) => params.append('compare', code));
      router.push(`${window.location.pathname}?${params.toString()}`);
      router.refresh();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button type="button" disabled={pending} onClick={recalculate} className="bg-brand hover:bg-brand-hover">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GitCompareArrows className="h-4 w-4" aria-hidden="true" />}
        {pending ? pendingLabel : label}
      </Button>
      {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{errorLabel}</p> : null}
    </div>
  );
}
