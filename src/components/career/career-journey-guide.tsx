'use client';

import { useEffect } from 'react';
import { Check, Circle, HelpCircle } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { TourOverlay, type TourStepConfig } from '@/components/tour/tour-overlay';
import { hasCompletedTour, useTourStore } from '@/stores/tour-store';
import { cn } from '@/lib/utils';

export type CareerJourneyItem = { href: string; label: string; description: string; tourKey: string };

const TOUR_ID = 'career-journey-v1';

export function CareerJourneyGuide({ items, helpLabel, progressLabel }: { items: CareerJourneyItem[]; helpLabel: string; progressLabel: string }) {
  const pathname = usePathname();
  const startTour = useTourStore((state) => state.startTour);
  const activeIndex = Math.max(0, items.findIndex((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)));
  const steps: TourStepConfig[] = items.map((item) => ({ target: item.tourKey, placement: 'bottom', i18nKey: item.tourKey }));

  useEffect(() => {
    if (hasCompletedTour(TOUR_ID) || window.innerWidth < 768) return;
    const frame = window.requestAnimationFrame(() => startTour(TOUR_ID, steps.length));
    return () => window.cancelAnimationFrame(frame);
  }, [startTour, steps.length]);

  return (
    <section className="border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50" aria-label={progressLabel}>
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{progressLabel} {activeIndex + 1}/{items.length}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => startTour(TOUR_ID, steps.length)} className="h-7 text-xs">
            <HelpCircle className="h-3.5 w-3.5" />{helpLabel}
          </Button>
        </div>
        <ol className="grid gap-2 md:grid-cols-4">
          {items.map((item, index) => {
            const current = index === activeIndex;
            const complete = index < activeIndex;
            return (
              <li key={item.href} data-tour={item.tourKey}>
                <Link href={item.href} aria-current={current ? 'step' : undefined} className={cn('flex min-h-14 items-start gap-2 rounded-lg border px-3 py-2 transition-colors', current ? 'border-brand/40 bg-brand/10' : 'border-zinc-200 bg-white hover:border-brand/30 dark:border-zinc-800 dark:bg-zinc-950')}>
                  <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]', complete ? 'bg-emerald-500 text-white' : current ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800')}>
                    {complete ? <Check className="h-3 w-3" /> : current ? index + 1 : <Circle className="h-3 w-3" />}
                  </span>
                  <span><span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">{item.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{item.description}</span></span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <TourOverlay tourId={TOUR_ID} steps={steps} />
    </section>
  );
}
