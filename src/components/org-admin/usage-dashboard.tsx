'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, AlertCircle, Inbox, BarChart3, Users, Cpu } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UsageSummary {
  totalConsumed: number;
  totalOperations: number;
  remainingBalance: number;
  period: { from: string; to: string };
}

interface MemberUsage {
  userId: string;
  email: string;
  name: string | null;
  operations: number;
  succeeded: number;
  failed: number;
}

interface ModelUsage {
  modelId: string;
  displayName: string | null;
  attempts: number;
  succeeded: number;
  failed: number;
}

interface UsageResponse {
  summary: UsageSummary;
  byMember: MemberUsage[];
  byModel: ModelUsage[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UsageDashboard({
  orgId,
  orgName,
}: {
  orgId: string;
  orgName: string;
}) {
  const t = useTranslations('orgAdmin.usage');

  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Date range — default to last 30 days
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [fromDate, setFromDate] = useState(defaultFrom.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(now.toISOString().slice(0, 10));

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({
        from: new Date(fromDate).toISOString(),
        to: new Date(toDate).toISOString(),
      });
      const res = await fetch(`/api/organizations/${orgId}/usage?${params}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const json: UsageResponse = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orgId, fromDate, toDate]);

  useEffect(() => {
    fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Apply date filter ────────────────────────────────────────────────────

  const handleApplyFilter = () => {
    fetchUsage();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchUsage}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const summary = data?.summary;
  const byMember = data?.byMember ?? [];
  const byModel = data?.byModel ?? [];
  const hasData = (summary?.totalOperations ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('title')}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('description', { name: orgName })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={fetchUsage}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {t('refresh')}
          </Button>
        </div>

        {/* Date range filter */}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="space-y-1">
            <Label htmlFor="usage-from" className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('dateFrom')}
            </Label>
            <Input
              id="usage-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-auto"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="usage-to" className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('dateTo')}
            </Label>
            <Input
              id="usage-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-auto"
            />
          </div>
          <Button size="sm" onClick={handleApplyFilter} disabled={loading}>
            {t('apply')}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            <BarChart3 className="h-3.5 w-3.5" />
            {t('summary.totalConsumed')}
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {(summary?.totalConsumed ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t('summary.remaining')}
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {(summary?.remainingBalance ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t('summary.operations')}
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
            {(summary?.totalOperations ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {hasData ? (
        <>
          {/* By Member table */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <Users className="h-4 w-4 text-zinc-400" />
                {t('byMember.title')}
              </h2>
            </div>
            <div className="px-2 sm:px-6">
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {/* Column header — desktop */}
                <div className="hidden grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                  <span>{t('byMember.colName')}</span>
                  <span />
                  <span className="text-right">{t('byMember.colOperations')}</span>
                  <span className="text-right">{t('byMember.colSucceeded')}</span>
                  <span className="text-right">{t('byMember.colFailed')}</span>
                </div>
                {byMember.map((m) => (
                  <div
                    key={m.userId}
                    className="grid grid-cols-2 gap-2 px-4 py-3 text-sm sm:grid-cols-[2fr_2fr_1fr_1fr_1fr] sm:items-center"
                  >
                    <div className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                      {m.name || m.email}
                    </div>
                    <div className="truncate text-zinc-500 dark:text-zinc-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byMember.colName')}:{' '}
                      </span>
                      {m.email}
                    </div>
                    <div className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byMember.colOperations')}:{' '}
                      </span>
                      {m.operations}
                    </div>
                    <div className="text-right tabular-nums text-green-600 dark:text-green-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byMember.colSucceeded')}:{' '}
                      </span>
                      {m.succeeded}
                    </div>
                    <div className="text-right tabular-nums text-red-500 dark:text-red-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byMember.colFailed')}:{' '}
                      </span>
                      {m.failed}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* By Model table */}
          <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                <Cpu className="h-4 w-4 text-zinc-400" />
                {t('byModel.title')}
              </h2>
            </div>
            <div className="px-2 sm:px-6">
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {/* Column header — desktop */}
                <div className="hidden grid-cols-[3fr_1fr_1fr_1fr] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                  <span>{t('byModel.colModel')}</span>
                  <span className="text-right">{t('byModel.colAttempts')}</span>
                  <span className="text-right">{t('byModel.colSucceeded')}</span>
                  <span className="text-right">{t('byModel.colFailed')}</span>
                </div>
                {byModel.map((m) => (
                  <div
                    key={m.modelId}
                    className="grid grid-cols-2 gap-2 px-4 py-3 text-sm sm:grid-cols-[3fr_1fr_1fr_1fr] sm:items-center"
                  >
                    <div className="truncate font-medium text-zinc-900 dark:text-zinc-50 sm:col-span-1">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byModel.colModel')}:{' '}
                      </span>
                      {m.displayName || m.modelId}
                    </div>
                    <div className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byModel.colAttempts')}:{' '}
                      </span>
                      {m.attempts}
                    </div>
                    <div className="text-right tabular-nums text-green-600 dark:text-green-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byModel.colSucceeded')}:{' '}
                      </span>
                      {m.succeeded}
                    </div>
                    <div className="text-right tabular-nums text-red-500 dark:text-red-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('byModel.colFailed')}:{' '}
                      </span>
                      {m.failed}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
        </div>
      )}
    </div>
  );
}
