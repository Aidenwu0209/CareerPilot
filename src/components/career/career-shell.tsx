import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CircleHelp } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function CareerPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
        ) : null}
        <h1 className="text-balance text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CareerMetricCard({
  label,
  value,
  suffix,
  description,
  unknownLabel,
  icon: Icon,
}: {
  label: string;
  value: number | string | null | undefined;
  suffix?: string;
  description: string;
  unknownLabel: string;
  icon: LucideIcon;
}) {
  const hasValue = value !== null && value !== undefined && value !== '';

  return (
    <Card className="gap-4 py-5 shadow-none">
      <CardHeader className="grid grid-cols-[1fr_auto] gap-3 px-5">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-2 text-2xl">
            {hasValue ? (
              <>
                {value}
                {suffix ? <span className="ml-0.5 text-sm font-medium text-zinc-500">{suffix}</span> : null}
              </>
            ) : (
              <span className="text-base font-medium text-zinc-500 dark:text-zinc-400">{unknownLabel}</span>
            )}
          </CardTitle>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </CardHeader>
      <CardContent className="px-5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {description}
      </CardContent>
    </Card>
  );
}

export function CareerSection({
  title,
  description,
  href,
  actionLabel,
  children,
  className,
}: {
  title: string;
  description?: string;
  href?: string;
  actionLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-5 py-5 shadow-none', className)}>
      <CardHeader className="px-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
            {description ? <CardDescription className="mt-1 leading-5">{description}</CardDescription> : null}
          </div>
          {href && actionLabel ? (
            <Button asChild variant="ghost" size="sm" className="-mr-2 text-brand hover:text-brand">
              <Link href={href}>
                {actionLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-5 sm:px-6">{children}</CardContent>
    </Card>
  );
}

export function ScoreBar({
  label,
  value,
  unknownLabel,
  detail,
}: {
  label: string;
  value: number | null | undefined;
  unknownLabel: string;
  detail?: string;
}) {
  const normalized = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3 text-sm">
        <div>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
          {detail ? <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</p> : null}
        </div>
        <span className="shrink-0 font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
          {normalized === null ? unknownLabel : `${normalized}%`}
        </span>
      </div>
      {normalized !== null ? (
        <div
          className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={normalized}
          aria-valuetext={`${normalized}%`}
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${normalized}%` }} />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          {unknownLabel}
        </div>
      )}
    </div>
  );
}

export function EmptyCareerState({
  icon: Icon,
  title,
  description,
  href,
  actionLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">{description}</p>
      {href && actionLabel ? (
        <Button asChild className="mt-5 bg-brand hover:bg-brand-hover">
          <Link href={href}>{actionLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function EvidenceBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="border-brand/20 bg-brand/5 text-brand dark:bg-brand/10">
      {children}
    </Badge>
  );
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'warning';
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        tone === 'positive' && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
        tone === 'neutral' && 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
      )}
    >
      {children}
    </Badge>
  );
}
