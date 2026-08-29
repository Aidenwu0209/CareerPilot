'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { LockKeyhole, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { CareerPaidFeature } from '@/lib/career/growth-service';

export function CareerFeatureUnlock({ feature, priceCredits, title, description }: {
  feature: CareerPaidFeature;
  priceCredits: number;
  title: string;
  description: string;
}) {
  const zh = useLocale() === 'zh';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function unlock() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/career/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'UNLOCK_FAILED');
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNLOCK_FAILED'); }
    finally { setBusy(false); }
  }
  return <section className="relative overflow-hidden rounded-xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900 dark:bg-amber-950/20">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 space-y-3 p-4 opacity-30 blur-sm"><div className="h-5 w-2/3 rounded bg-amber-400" /><div className="h-10 rounded bg-amber-300" /><div className="h-10 w-5/6 rounded bg-amber-300" /></div>
    <div className="relative flex flex-col gap-4 rounded-lg bg-amber-50/90 p-2 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/80">
      <div className="flex gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950 dark:text-amber-100">{title}</h2><p className="mt-1 text-sm leading-6 text-amber-800 dark:text-amber-200">{description}</p></div></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button onClick={unlock} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{zh ? `${priceCredits} 点解锁` : `Unlock for ${priceCredits} credits`}</Button><Button asChild variant="outline"><Link href="/credits#billing-options">{zh ? '查看套餐' : 'View plans'}</Link></Button></div>
    </div>
    {error && <p role="alert" className="relative mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
