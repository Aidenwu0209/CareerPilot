'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  RefreshCw,
  UserPlus,
  AlertCircle,
  Inbox,
  Loader2,
  ShieldCheck,
  User,
  UserMinus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readJsonResponse, readOptionalJsonBody } from '@/lib/http/json-client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Member {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'org_admin' | 'member';
  status: 'active' | 'removed';
  joinedAt: string;
}

interface Seats {
  used: number;
  limit: number;
}

const KNOWN_API_ERRORS = new Set([
  'USER_NOT_FOUND',
  'ALREADY_MEMBER',
  'SEAT_LIMIT_EXCEEDED',
  'BILLING_CONFLICT',
  'CANNOT_ADD_SUPER_ADMIN',
  'CANNOT_REMOVE_ADMIN',
  'ALREADY_REMOVED',
  'MEMBERSHIP_NOT_FOUND',
  'EMAIL_REQUIRED',
  'INVALID_BODY',
  'ORG_SUSPENDED',
  'FORBIDDEN',
  'AUTH_REQUIRED',
]);

// ─── Component ──────────────────────────────────────────────────────────────

export function MembersManager({
  orgId,
  orgName,
  seatLimit,
}: {
  orgId: string;
  orgName: string;
  seatLimit: number;
}) {
  const t = useTranslations('orgAdmin.members');
  const locale = useLocale();

  const [members, setMembers] = useState<Member[]>([]);
  const [seats, setSeats] = useState<Seats>({ used: 0, limit: seatLimit });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Remove member dialog
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/organizations/${orgId}/members`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await readJsonResponse<{ members: Member[]; seats: Seats }>(res);
      setMembers(data.members);
      setSeats(data.seats);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ─── Add member ───────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const email = addEmail.trim();
    if (!email) {
      toast.error(t('errEmailRequired'));
      return;
    }

    setAddLoading(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await readOptionalJsonBody<{ error?: string }>(res);
      if (!res.ok) {
        const msg =
          data?.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('addFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('addSuccess', { email }));
      setAddOpen(false);
      setAddEmail('');
      fetchMembers();
    } catch {
      toast.error(t('addFailed'));
    } finally {
      setAddLoading(false);
    }
  };

  // ─── Remove member ────────────────────────────────────────────────────────

  const handleRemove = async () => {
    if (!removeTarget) return;

    setRemoveLoading(true);
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/members/${removeTarget.userId}`,
        { method: 'DELETE' },
      );
      const data = await readOptionalJsonBody<{ error?: string }>(res);
      if (!res.ok) {
        const msg =
          data?.error && KNOWN_API_ERRORS.has(data.error)
            ? t(`errApi.${data.error}`)
            : t('removeFailed');
        toast.error(msg);
        return;
      }
      toast.success(t('removeSuccess', { name: removeTarget.name || removeTarget.email }));
      setRemoveTarget(null);
      fetchMembers();
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoveLoading(false);
    }
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

  const activeMembers = members.filter((m) => m.status === 'active');
  const seatsFull = seats.used >= seats.limit;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchMembers}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + seat summary */}
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
              <Users className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                {seats.used} / {seats.limit}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={fetchMembers}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('refresh')}
            </Button>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
            disabled={seatsFull}
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t('addMember')}
          </Button>
          {seatsFull && (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              {t('seatsFull')}
            </p>
          )}
        </div>
      </div>

      {/* Member list */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            <Users className="h-4 w-4 text-zinc-400" />
            {t('membersTitle')}
          </h2>
        </div>
        <div className="px-2 sm:px-6">
          {activeMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {/* Column header — desktop */}
              <div className="hidden grid-cols-[2fr_2fr_1fr_1.5fr_auto] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500 sm:grid">
                <span>{t('colName')}</span>
                <span>{t('colEmail')}</span>
                <span>{t('colRole')}</span>
                <span>{t('colJoined')}</span>
                <span />
              </div>
              {activeMembers.map((member) => {
                const isAdmin = member.role === 'org_admin';
                return (
                  <div
                    key={member.membershipId}
                    className="grid grid-cols-2 gap-2 px-4 py-3 text-sm sm:grid-cols-[2fr_2fr_1fr_1.5fr_auto] sm:items-center"
                  >
                    {/* Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      {isAdmin ? (
                        <ShieldCheck className="h-4 w-4 shrink-0 text-violet-500" />
                      ) : (
                        <User className="h-4 w-4 shrink-0 text-zinc-400" />
                      )}
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                        {member.name || member.email}
                      </span>
                    </div>
                    {/* Email */}
                    <div className="truncate text-zinc-500 dark:text-zinc-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('colEmail')}:{' '}
                      </span>
                      {member.email}
                    </div>
                    {/* Role */}
                    <div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          isAdmin
                            ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-400'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
                        )}
                      >
                        {isAdmin ? t('roleAdmin') : t('roleMember')}
                      </Badge>
                    </div>
                    {/* Joined */}
                    <div className="text-zinc-500 dark:text-zinc-400">
                      <span className="sm:hidden text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        {t('colJoined')}:{' '}
                      </span>
                      {formatDateTime(member.joinedAt)}
                    </div>
                    {/* Actions */}
                    <div className="flex justify-end">
                      {!isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-red-600 dark:text-red-400"
                          onClick={() => setRemoveTarget(member)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">{t('remove')}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => !open && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addTitle')}</DialogTitle>
            <DialogDescription>{t('addDescription', { name: orgName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="member-email">{t('fieldEmail')}</Label>
              <Input
                id="member-email"
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder={t('placeholderEmail')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAdd} disabled={addLoading}>
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('confirmAdd')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Dialog */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('removeTitle')}</DialogTitle>
            <DialogDescription>
              {t('removeDescription', {
                name: removeTarget?.name || removeTarget?.email || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleRemove} disabled={removeLoading} variant="destructive">
              {removeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('confirmRemove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
