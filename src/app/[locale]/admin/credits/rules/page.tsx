'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, AlertCircle, Loader2, Save, Coins, CalendarDays } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CreditRule {
  id: string;
  ruleType: 'registration_grant' | 'daily_limit_personal' | 'daily_limit_org';
  value: number;
  version: number;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const RULE_LABEL_KEYS: Record<string, string> = {
  registration_grant: 'ruleRegistrationGrant',
  daily_limit_personal: 'ruleDailyLimitPersonal',
  daily_limit_org: 'ruleDailyLimitOrg',
};

const RULE_ICONS: Record<string, typeof Coins> = {
  registration_grant: Coins,
  daily_limit_personal: CalendarDays,
  daily_limit_org: CalendarDays,
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminCreditRulesPage() {
  const t = useTranslations('admin.creditRules');

  const [rules, setRules] = useState<CreditRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Edit state: map of ruleType -> draft value
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/admin/credit-rules');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      const list: CreditRule[] = data.rules ?? [];
      setRules(list);
      // Initialize drafts from fetched values
      const initialDrafts: Record<string, string> = {};
      for (const r of list) {
        initialDrafts[r.ruleType] = String(r.value);
      }
      setDrafts(initialDrafts);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleSave = async (ruleType: string) => {
    const draftValue = drafts[ruleType];
    const parsed = parseInt(draftValue, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error(t('errInvalidValue'));
      return;
    }

    setSaving((prev) => ({ ...prev, [ruleType]: true }));
    try {
      const res = await fetch('/api/admin/credit-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleType, value: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error === 'INVALID_VALUE' || data.error === 'INVALID_RULE_TYPE'
          ? t('errInvalidValue')
          : t('errSaveFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('saveSuccess'));
      // Refresh to get new versions
      fetchRules();
    } catch {
      toast.error(t('errSaveFailed'));
    } finally {
      setSaving((prev) => ({ ...prev, [ruleType]: false }));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t('description')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRules} disabled={loading}>
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />
          {t('refresh')}
        </Button>
      </div>

      {/* Rules */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchRules}>
            {t('retry')}
          </Button>
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rules.map((rule) => {
            const Icon = RULE_ICONS[rule.ruleType] ?? Coins;
            const labelKey = RULE_LABEL_KEYS[rule.ruleType] ?? 'ruleUnknown';
            const draftValue = drafts[rule.ruleType] ?? '';
            const hasChanged = draftValue !== String(rule.value);
            const isSaving = saving[rule.ruleType] ?? false;

            return (
              <div
                key={rule.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left: rule info */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-zinc-400" />
                      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {t(labelKey)}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        v{rule.version}
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t(`${labelKey}Desc`)}
                    </p>
                  </div>

                  {/* Right: edit + save */}
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`rule-${rule.ruleType}`} className="text-xs text-zinc-400">
                        {t('fieldValue')}
                      </Label>
                      <Input
                        id={`rule-${rule.ruleType}`}
                        type="number"
                        min="0"
                        value={draftValue}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [rule.ruleType]: e.target.value }))
                        }
                        className="w-32"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={!hasChanged || isSaving}
                      onClick={() => handleSave(rule.ruleType)}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      {t('save')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hint */}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        {t('hintFutureOnly')}
      </p>
    </div>
  );
}
