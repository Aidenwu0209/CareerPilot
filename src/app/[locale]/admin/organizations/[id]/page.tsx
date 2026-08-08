'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft,
  RefreshCw,
  Coins,
  Plus,
  Minus,
  AlertCircle,
  Inbox,
  Loader2,
  Building2,
  Users,
  ShieldCheck,
  UserCog,
  UserMinus,
  UserPlus,
  Power,
  PowerOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrgAdmin {
  userId: string;
  name: string | null;
  email: string;
}

interface OrgDetail {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  seatLimit: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  balance: number;
  admins: OrgAdmin[];
}

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
  note: string;
  createdAt: string;
}

const PAGE_SIZE = 20;

const KNOWN_API_ERRORS = new Set([
  'INVALID_AMOUNT',
  'REASON_REQUIRED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INSUFFICIENT_CREDITS',
  'USER_NOT_FOUND',
  'ALREADY_ADMIN',
  'NOT_AN_ADMIN',
  'INVALID_STATUS',
  'INVALID_BODY',
  'FORBIDDEN',
  'AUTH_REQUIRED',
]);

const REASON_LABEL_KEYS: Record<string, string> = {
  registration_grant: 'reasons.registrationGrant',
  manual_credit: 'reasons.manualCredit',
  manual_debit: 'reasons.manualDebit',
  consumption: 'reasons.consumption',
  refund: 'reasons.refund',
  adjustment: 'reasons.adjustment',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminOrgDetailPage() {
  const t = useTranslations('admin.orgDetail');
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const orgId = params.id;

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [offset, setOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustDir, setAdjustDir] = useState<'credit' | 'debit'>('credit');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);

  // Admin appoint dialog
  const [appointOpen, setAppointOpen] = useState(false);
  const [appointEmail, setAppointEmail] = useState('');
  const [appointLoading, setAppointLoading] = useState(false);

  // Suspend/activate dialog
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendLoading, setSuspendLoading] = useState(false);

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchOrg = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setOrg(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const fetchTransactions = useCallback(
    async (newOffset: number) => {
      setTxLoading(true);
      setTxError(false);
      try {
        const res = await fetch(
          `/api/admin/organizations/${orgId}/transactions?limit=${PAGE_SIZE}&offset=${newOffset}`,
        );
        if (!res.ok) {
          setTxError(true);
          return;
        }
        const data = await res.json();
        setTransactions(data.transactions);
        setHasMore(data.transactions.length === PAGE_SIZE);
      } catch {
        setTxError(true);
      } finally {
        setTxLoading(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useEffect(() => {
    fetchTransactions(0);
  }, [fetchTransactions]);

  // ─── Adjust handler ───────────────────────────────────────────────────────

  const handleAdjust = async () => {
    const parsed = parseInt(adjustAmount, 10);
    if (!Number.isInteger(parsed) || parsed === 0) {
      toast.error(t('errInvalidAmount'));
      return;
    }
    if (!adjustNote.trim()) {
      toast.error(t('errNoteRequired'));
      return;
    }

    const amount = adjustDir === 'credit' ? Math.abs(parsed) : -Math.abs(parsed);

    setAdjustLoading(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          reason: adjustNote.trim(),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('adjustFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('adjustSuccess', { amount: amount > 0 ? `+${amount}` : `${amount}` }));
      setAdjustOpen(false);
      setAdjustAmount('');
      setAdjustNote('');
      fetchOrg();
      fetchTransactions(offset);
    } catch {
      toast.error(t('adjustFailed'));
    } finally {
      setAdjustLoading(false);
    }
  };

  const handleOpenAdjust = (dir: 'credit' | 'debit') => {
    setAdjustDir(dir);
    setAdjustAmount('');
    setAdjustNote('');
    setAdjustOpen(true);
  };

  // ─── Admin appoint/revoke ────────────────────────────────────────────────

  const handleAppoint = async () => {
    const email = appointEmail.trim();
    if (!email) {
      toast.error(t('errEmailRequired'));
      return;
    }

    setAppointLoading(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('appointFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('appointSuccess', { email }));
      setAppointOpen(false);
      setAppointEmail('');
      fetchOrg();
    } catch {
      toast.error(t('appointFailed'));
    } finally {
      setAppointLoading(false);
    }
  };

  const handleRevoke = async (email: string) => {
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/admins`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('revokeFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('revokeSuccess', { email }));
      fetchOrg();
    } catch {
      toast.error(t('revokeFailed'));
    }
  };

  // ─── Suspend/activate ────────────────────────────────────────────────────

  const handleToggleStatus = async () => {
    if (!org) return;
    const newStatus = org.status === 'active' ? 'suspended' : 'active';

    setSuspendLoading(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('statusChangeFailed');
        toast.error(msg);
        return;
      }
      toast.success(newStatus === 'suspended' ? t('suspendSuccess') : t('activateSuccess'));
      setSuspendOpen(false);
      fetchOrg();
    } catch {
      toast.error(t('statusChangeFailed'));
    } finally {
      setSuspendLoading(false);
    }
  };

  // ─── Pagination ───────────────────────────────────────────────────────────

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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchOrg}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const isActive = org.status === 'active';

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link href="/admin/organizations">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            {t('backToOrgs')}
          </Button>
        </Link>
      </div>

      {/* Org header + balance */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Left: identity */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="h-5 w-5 text-zinc-400" />
              <h1 className="truncate text-xl font-bold text-zinc-900 dark:text-zinc-50">
                {org.name}
              </h1>
              <Badge variant="outline" className="text-xs text-zinc-500">
                {org.slug}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  isActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400',
                )}
              >
                {isActive ? t('statusActive') : t('statusSuspended')}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {t('seats')}:{' '}
                <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                  {org.memberCount} / {org.seatLimit}
                </span>
              </span>
              {org.createdAt && (
                <span>
                  {t('createdAt')}:{' '}
                  {formatDateTime(org.createdAt)}
                </span>
              )}
            </div>
          </div>

          {/* Right: balance + actions */}
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('balance')}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Coins className="h-5 w-5 text-amber-500" />
                <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {org.balance.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button variant="outline" size="sm" className="gap-1.5 text-emerald-600 dark:text-emerald-400" onClick={() => handleOpenAdjust('credit')}>
            <Plus className="h-3.5 w-3.5" />
            {t('addQuota')}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-red-600 dark:text-red-400" onClick={() => handleOpenAdjust('debit')}>
            <Minus className="h-3.5 w-3.5" />
            {t('deductQuota')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'gap-1.5',
              isActive
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400',
            )}
            onClick={() => setSuspendOpen(true)}
          >
            {isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            {isActive ? t('suspend') : t('activate')}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 ml-auto" onClick={() => { fetchOrg(); fetchTransactions(offset); }}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Admins section */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            <UserCog className="h-4 w-4 text-zinc-400" />
            {t('adminsTitle')}
          </h2>
          <Button size="sm" className="gap-1.5" onClick={() => setAppointOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            {t('appoint')}
          </Button>
        </div>
        <div className="px-2 sm:px-6">
          {org.admins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('noAdmins')}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {org.admins.map((admin) => (
                <div key={admin.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-violet-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {admin.name || admin.email}
                      </p>
                      {admin.name && (
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {admin.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-red-600 dark:text-red-400"
                    onClick={() => handleRevoke(admin.email)}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    {t('revoke')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Transactions */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {t('transactionHistory')}
          </h2>
        </div>
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
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchTransactions(offset)}>
                {t('retry')}
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
            </div>
          ) : (
            <>
              {/* Table header — desktop */}
              <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_2fr] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                <span>{t('colTime')}</span>
                <span>{t('colType')}</span>
                <span className="text-right">{t('colAmount')}</span>
                <span className="text-right">{t('colBalanceAfter')}</span>
                <span>{t('colNote')}</span>
              </div>
              {/* Rows */}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {transactions.map((tx) => {
                  const isCredit = tx.delta >= 0;
                  const reasonKey = REASON_LABEL_KEYS[tx.reason] ?? 'reasons.adjustment';
                  return (
                    <div
                      key={tx.id}
                      className="grid grid-cols-2 gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_1fr_1fr_1fr_2fr] sm:items-center"
                    >
                      <div className="text-zinc-500 dark:text-zinc-400">
                        <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          {t('colTime')}:{' '}
                        </span>
                        {formatDateTime(tx.createdAt)}
                      </div>
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
                      <div className="text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                          {t('colBalanceAfter')}:{' '}
                        </span>
                        {tx.balanceAfter}
                      </div>
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
                  <Button variant="outline" size="sm" disabled={offset === 0 || txLoading} onClick={handlePrev}>
                    <ChevronLeft className="h-4 w-4" />
                    {t('prev')}
                  </Button>
                  <Button variant="outline" size="sm" disabled={!hasMore || txLoading} onClick={handleNext}>
                    {t('next')}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Adjust Dialog */}
      <Dialog open={adjustOpen} onOpenChange={(open) => !open && setAdjustOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustDir === 'credit' ? t('addTitle') : t('deductTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('adjustDescription', { name: org.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="adjust-amount">{t('fieldAmount')}</Label>
              <Input
                id="adjust-amount"
                type="number"
                min="1"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder={adjustDir === 'credit' ? t('placeholderAmountAdd') : t('placeholderAmountDeduct')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjust-note">{t('fieldNote')}</Label>
              <Textarea
                id="adjust-note"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder={t('placeholderNote')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAdjust} disabled={adjustLoading}>
              {adjustLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {adjustDir === 'credit' ? t('confirmAdd') : t('confirmDeduct')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Appoint Dialog */}
      <Dialog open={appointOpen} onOpenChange={(open) => !open && setAppointOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('appointTitle')}</DialogTitle>
            <DialogDescription>{t('appointDescription', { name: org.name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="appoint-email">{t('fieldEmail')}</Label>
              <Input
                id="appoint-email"
                type="email"
                value={appointEmail}
                onChange={(e) => setAppointEmail(e.target.value)}
                placeholder={t('placeholderEmail')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAppoint();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppointOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAppoint} disabled={appointLoading}>
              {appointLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('confirmAppoint')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend/Activate Dialog */}
      <Dialog open={suspendOpen} onOpenChange={(open) => !open && setSuspendOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isActive ? t('suspendTitle') : t('activateTitle')}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? t('suspendDescription', { name: org.name, count: org.memberCount })
                : t('activateDescription', { name: org.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleToggleStatus}
              disabled={suspendLoading}
              variant={isActive ? 'destructive' : 'default'}
            >
              {suspendLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isActive ? t('confirmSuspend') : t('confirmActivate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
