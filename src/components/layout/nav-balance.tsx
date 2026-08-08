'use client';

import { Link } from '@/i18n/routing';
import { useCredits } from '@/hooks/use-credits';
import { useTranslations } from 'next-intl';
import { Coins, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatBalance(value: number): string {
  if (value >= 10000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

export function NavBalance() {
  const { balance, billingScope, loading } = useCredits();
  const t = useTranslations('nav');

  // Skeleton during initial load — stable dimensions prevent layout shift
  if (loading && balance === null) {
    return (
      <div
        className="h-8 w-[5.5rem] animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"
        aria-hidden
      />
    );
  }

  // Silent failure — don't clutter the nav with errors
  if (balance === null) {
    return null;
  }

  const isOrg = billingScope?.type === 'organization';
  const orgName = billingScope?.orgName;

  return (
    <Link
      href="/credits"
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5',
        'text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
        'min-w-[5.5rem]',
      )}
      title={isOrg ? orgName ?? t('orgCredits') : t('personalCredits')}
    >
      {isOrg ? (
        <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      ) : (
        <Coins className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      {isOrg && orgName ? (
        <>
          <span
            className="max-w-[72px] truncate text-xs text-zinc-500 dark:text-zinc-400"
          >
            {orgName}
          </span>
          <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
            {formatBalance(balance)}
          </span>
        </>
      ) : (
        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
          {formatBalance(balance)}
        </span>
      )}
    </Link>
  );
}
