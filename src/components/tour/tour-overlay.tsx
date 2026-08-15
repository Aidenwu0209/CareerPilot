'use client';

import { useEffect, useState, useCallback, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTourStore } from '@/stores/tour-store';

type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStepConfig {
  target: string;
  placement: Placement;
  /** i18n key for this step under the tour namespace, e.g. "sidebar" → tour.steps.sidebar.title */
  i18nKey: string;
}

interface TourOverlayProps {
  tourId: string;
  steps: TourStepConfig[];
}

const PADDING = 8;
const TOOLTIP_GAP = 12;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function buildClipPath(rect: Rect): string {
  const { top, left, width, height } = rect;
  const t = top - PADDING;
  const l = left - PADDING;
  const r = left + width + PADDING;
  const b = top + height + PADDING;

  return `polygon(
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px
  )`;
}

function calcTooltipStyle(
  rect: Rect,
  placement: Placement,
  tooltipW: number,
  tooltipH: number
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 0;
  let left = 0;

  switch (placement) {
    case 'right':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left + rect.width + PADDING + TOOLTIP_GAP;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - tooltipH / 2;
      left = rect.left - PADDING - TOOLTIP_GAP - tooltipW;
      break;
    case 'bottom':
      top = rect.top + rect.height + PADDING + TOOLTIP_GAP;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case 'top':
      top = rect.top - PADDING - TOOLTIP_GAP - tooltipH;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
  }

  // Viewport clamping
  if (left < 12) left = 12;
  if (left + tooltipW > vw - 12) left = vw - 12 - tooltipW;
  if (top < 12) top = 12;
  if (top + tooltipH > vh - 12) top = vh - 12 - tooltipH;

  return { position: 'fixed', top, left };
}

export function TourOverlay({ tourId, steps }: TourOverlayProps) {
  const t = useTranslations('tour');
  const { isActive, activeTourId, currentStep, totalSteps, nextStep, prevStep, dismiss, dismissAll } = useTourStore();
  const [rect, setRect] = useState<Rect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 320, h: 160 });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const isMyTour = isActive && activeTourId === tourId;

  const updateRect = useCallback(() => {
    if (!isMyTour) return;
    const step = steps[currentStep];
    if (!step) return;
    const r = getTargetRect(step.target);
    setRect(r);
  }, [isMyTour, currentStep, steps]);

  useEffect(() => {
    if (!isMyTour) return;
    // If target element doesn't exist, skip to next step
    const step = steps[currentStep];
    if (step && !document.querySelector(`[data-tour="${step.target}"]`)) {
      nextStep();
      return;
    }
    const frame = window.requestAnimationFrame(updateRect);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [isMyTour, currentStep, updateRect, steps, nextStep]);

  useEffect(() => {
    if (tooltipRef.current) {
      const r = tooltipRef.current.getBoundingClientRect();
      setTooltipSize({ w: r.width, h: r.height });
    }
  }, [currentStep, isMyTour, rect]);

  useEffect(() => {
    if (!isMyTour) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      returnFocusRef.current = null;
    };
  }, [dismiss, isMyTour]);

  const hasTargetRect = rect !== null;
  useEffect(() => {
    if (!isMyTour || !hasTargetRect) return;
    const frame = window.requestAnimationFrame(() => {
      tooltipRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentStep, hasTargetRect, isMyTour]);

  // Skip on mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!isMyTour || isMobile || typeof document === 'undefined') return null;

  const step = steps[currentStep];
  const isLast = currentStep === totalSteps - 1;
  const isFirst = currentStep === 0;

  const overlay = (
    <>
      {/* Dark overlay with spotlight cutout */}
      <div
        className="pointer-events-none fixed inset-0 z-[9999] transition-all duration-300 motion-reduce:transition-none"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          clipPath: rect ? buildClipPath(rect) : undefined,
        }}
        aria-hidden="true"
      />

      {/* Highlight ring around target */}
      {rect && (
        <div
          className="pointer-events-none fixed z-[9999] rounded-lg ring-2 ring-brand ring-offset-2 transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
          }}
        />
      )}

      {/* Tooltip card */}
      {rect && (
        <div
          ref={tooltipRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="fixed z-[10000] w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl outline-none transition-all duration-300 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900"
          style={calcTooltipStyle(rect, step.placement, tooltipSize.w, tooltipSize.h)}
        >
          <div className="mb-1 flex items-center justify-between">
            <h3 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t(`steps.${step.i18nKey}.title`)}
            </h3>
            <button
              onClick={dismiss}
              aria-label={t('close')}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p id={descriptionId} className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t(`steps.${step.i18nKey}.description`)}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              {currentStep + 1} / {totalSteps}
            </span>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button variant="ghost" size="sm" onClick={prevStep} className="h-7 cursor-pointer gap-1 px-2 text-xs">
                  <ChevronLeft className="h-3 w-3" />
                  {t('prev')}
                </Button>
              )}
              {isFirst && (
                <Button variant="ghost" size="sm" onClick={dismiss} className="h-7 cursor-pointer px-2 text-xs text-zinc-400">
                  {t('skip')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={nextStep}
                className="h-7 cursor-pointer gap-1 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
              >
                {isLast ? t('finish') : t('next')}
                {!isLast && <ChevronRight className="h-3 w-3" />}
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissAll}
            className="mt-3 w-full border-t border-zinc-100 pt-3 text-center text-xs text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-zinc-800 dark:hover:text-zinc-200"
          >
            {t('disableAll')}
          </button>
        </div>
      )}
    </>
  );

  return createPortal(overlay, document.body);
}
