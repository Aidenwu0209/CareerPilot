'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useCredits } from '@/hooks/use-credits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Coins, Building2, ChevronLeft, ChevronRight, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BillingPanel } from '@/components/billing/billing-panel';
import { useAuth } from '@/hooks/use-auth';

interface Transaction {
  id: string;
  accountId: string;
  balanceBefore: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  operatorId: string | null;
  businessRefId: string | null;
  idempotencyKey: string;
  ruleSnapshot: unknown;
  note: string;
  createdAt: string;
}

interface TransactionsResponse {
  accountId: string;
  balance: number;
  transactions: Transaction[];
  pagination: { limit: number; offset: number; count: number };
}

const PAGE_SIZE = 20;

/** Format an ISO date string as a localized date-time. */
function formatDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Map a credit reason to a Badge variant + display label key. */
const REASON_LABEL_KEYS: Record<string, string> = {
  registration_grant: 'reasons.registrationGrant',
  manual_credit: 'reasons.manualCredit',
  manual_debit: 'reasons.manualDebit',
  consumption: 'reasons.consumption',
  refund: 'reasons.refund',
  purchase_credit: 'reasons.purchaseCredit',
  subscription_credit: 'reasons.subscriptionCredit',
  payment_refund: 'reasons.paymentRefund',
  payment_refund_rollback: 'reasons.paymentRefundRollback',
  adjustment: 'reasons.adjustment',
};

export default function CreditsPage() {
  const t = useTranslations('credits');
  const { balance, billingScope, loading: balanceLoading } = useCredits();
  const locale = useLocale();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [offset, setOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const fetchTransactions = useCallback(async (newOffset: number) => {
    setTxLoading(true);
    setTxError(false);
    try {
      const res = await fetch(
        `/api/credits/transactions?limit=${PAGE_SIZE}&offset=${newOffset}`,
      );
      if (!res.ok) {
        setTxError(true);
        return;
      }
      const data: TransactionsResponse = await res.json();
      setTransactions(data.transactions);
      setHasMore(data.transactions.length === PAGE_SIZE);
    } catch {
      setTxError(true);
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) fetchTransactions(0);
  }, [authLoading, isAuthenticated, fetchTransactions]);

  const handlePrev = () => {
    const newOffset = Math.max(0, offset - PAGE_SIZE);
    setOffset(newOffset);
    fetchTransactions(newOffset);
  };

  const handleNext = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchTransactions(newOffset);
  };

  const isOrg = billingScope?.type === 'organization';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t('description')}
        </p>
      </div>

      {/* Balance card */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isOrg ? (
              <Building2 className="h-8 w-8 text-zinc-400" />
            ) : (
              <Coins className="h-8 w-8 text-amber-500" />
            )}
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('accountType')}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {isOrg
                    ? (billingScope?.orgName ?? t('orgAccount'))
                    : t('personalAccount')}
                </span>
                <Badge variant={isOrg ? 'secondary' : 'default'} className="text-xs">
                  {isOrg ? t('orgBadge') : t('personalBadge')}
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('availableBalance')}
            </p>
            {balanceLoading && balance === null ? (
              <Skeleton className="mt-1 h-8 w-24" />
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                {balance ?? 0}
              </p>
            )}
          </div>
        </div>
      </div>

      <BillingPanel personalAccount={!isOrg} />

      {/* Transactions */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t('transactionHistory')}
          </h2>
        </div>

        {/* Transaction content */}
        <div className="px-2 sm:px-6">
          {txLoading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : txError ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('loadError')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => fetchTransactions(offset)}
              >
                {t('retry')}
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('empty')}
              </p>
            </div>
          ) : (
            <>
              {/* Table header — desktop only */}
              <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_2fr] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                <span>{t('colTime')}</span>
                <span>{t('colType')}</span>
                <span className="text-right">{t('colAmount')}</span>
                <span className="text-right">{t('colBalanceAfter')}</span>
                <span>{t('colNote')}</span>
              </div>

              {/* Transaction rows */}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {transactions.map((tx) => {
                  const isCredit = tx.delta >= 0;
                  const reasonKey = REASON_LABEL_KEYS[tx.reason] ?? 'reasons.adjustment';

                  return (
                    <div
                      key={tx.id}
                      className="grid grid-cols-2 gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_1fr_1fr_1fr_2fr] sm:items-center"
                    >
                      {/* Time */}
                      <div className="text-zinc-500 dark:text-zinc-400">
                        <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          {t('colTime')}:{' '}
                        </span>
                        {formatDateTime(tx.createdAt, locale)}
                      </div>

                      {/* Type badge */}
                      <div>
                        <Badge
                          variant={isCredit ? 'default' : 'secondary'}
                          className={cn(
                            'text-xs',
                            isCredit
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                          )}
                        >
                          {t(reasonKey)}
                        </Badge>
                      </div>

                      {/* Delta */}
                      <div
                        className={cn(
                          'text-right font-medium tabular-nums',
                          isCredit
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-zinc-700 dark:text-zinc-300',
                        )}
                      >
                        <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          {t('colAmount')}:{' '}
                        </span>
                        {isCredit ? '+' : ''}
                        {tx.delta}
                      </div>

                      {/* Balance after */}
                      <div className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          {t('colBalanceAfter')}:{' '}
                        </span>
                        {tx.balanceAfter}
                      </div>

                      {/* Note */}
                      <div className="col-span-2 truncate text-zinc-500 dark:text-zinc-400 sm:col-span-1">
                        {tx.note || '—'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {offset > 0 && (
                    <>
                      {offset + 1}–{offset + transactions.length}
                    </>
                  )}
                  {offset === 0 && transactions.length > 0 && (
                    <>
                      1–{transactions.length}
                    </>
                  )}
                  {transactions.length === 0 && t('empty')}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0 || txLoading}
                    onClick={handlePrev}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t('prev')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasMore || txLoading}
                    onClick={handleNext}
                  >
                    {t('next')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
