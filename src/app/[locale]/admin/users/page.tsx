'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  RefreshCw,
  Search,
  Snowflake,
  Sun,
  AlertCircle,
  Inbox,
  Loader2,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UserOrg {
  orgId: string;
  orgName: string;
  orgRole: string;
}

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  platformRole: 'super_admin' | 'user';
  status: 'active' | 'suspended';
  createdAt: string;
  balance: number;
  organizations: UserOrg[];
}

const KNOWN_API_ERRORS = new Set([
  'INVALID_ACTION',
  'IDEMPOTENCY_KEY_REQUIRED',
  'USER_NOT_FOUND',
  'INVALID_BODY',
  'FORBIDDEN',
  'AUTH_REQUIRED',
]);

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const t = useTranslations('admin.users');

  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Freeze/unfreeze confirmation
  const [toggleUser, setToggleUser] = useState<UserInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchUsers = useCallback(async (q: string) => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers('');
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(searchQuery.trim());
    fetchUsers(searchQuery.trim());
  };

  const handleToggle = async (user: UserInfo) => {
    const action = user.status === 'active' ? 'freeze' : 'unfreeze';
    setActionLoading((prev) => ({ ...prev, [user.id]: true }));
    try {
      const res = await fetch(`/api/admin/users/${user.id}/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error && KNOWN_API_ERRORS.has(data.error)
          ? t(`errApi.${data.error}`)
          : t('toggleFailed');
        toast.error(msg);
        return;
      }
      toast.success(action === 'freeze' ? t('frozen') : t('unfrozen'));
      // Update list immediately (AC2)
      fetchUsers(submittedQuery);
    } catch {
      toast.error(t('toggleFailed'));
    } finally {
      setActionLoading((prev) => ({ ...prev, [user.id]: false }));
      setToggleUser(null);
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
        <Button variant="outline" size="sm" onClick={() => fetchUsers(submittedQuery)} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="default" size="sm" disabled={loading}>
          {t('search')}
        </Button>
        {submittedQuery && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSubmittedQuery('');
              fetchUsers('');
            }}
          >
            {t('clear')}
          </Button>
        )}
      </form>

      {/* User list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchUsers(submittedQuery)}>
            {t('retry')}
          </Button>
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {submittedQuery ? t('noResults') : t('empty')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isActive = user.status === 'active';
            const isSuperAdmin = user.platformRole === 'super_admin';

            return (
              <div
                key={user.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left: identity */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {user.name || user.email}
                      </h3>
                      {/* Role badge */}
                      <Badge
                        variant="outline"
                        className={cn(
                          'gap-1 text-xs',
                          isSuperAdmin
                            ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-400'
                            : '',
                        )}
                      >
                        {isSuperAdmin ? (
                          <ShieldCheck className="h-3 w-3" />
                        ) : (
                          <UserIcon className="h-3 w-3" />
                        )}
                        {isSuperAdmin ? t('roleAdmin') : t('roleUser')}
                      </Badge>
                      {/* Status badge */}
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

                    {/* Details */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="truncate">{user.email}</span>
                      <span>
                        {t('balance')}:{' '}
                        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                          {user.balance.toLocaleString()}
                        </span>
                      </span>
                      {user.organizations.length > 0 && (
                        <span>
                          {t('orgs')}:{' '}
                          {user.organizations.map((org, i) => (
                            <span key={org.orgId}>
                              {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">, </span>}
                              <span className="text-zinc-700 dark:text-zinc-300">{org.orgName}</span>
                              <span className="text-zinc-400"> ({org.orgRole})</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'gap-1.5',
                        !isActive && 'text-emerald-600 dark:text-emerald-400',
                      )}
                      onClick={() => setToggleUser(user)}
                      disabled={actionLoading[user.id] || isSuperAdmin}
                      title={isSuperAdmin ? t('cannotFreezeAdmin') : undefined}
                    >
                      {actionLoading[user.id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isActive ? (
                        <Snowflake className="h-3.5 w-3.5" />
                      ) : (
                        <Sun className="h-3.5 w-3.5" />
                      )}
                      {isActive ? t('freeze') : t('unfreeze')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Freeze/Unfreeze Confirmation */}
      <AlertDialog
        open={!!toggleUser}
        onOpenChange={(open) => !open && setToggleUser(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleUser?.status === 'active' ? t('confirmFreeze') : t('confirmUnfreeze')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleUser?.status === 'active'
                ? t('confirmFreezeDesc', { name: toggleUser?.name || toggleUser?.email || '' })
                : t('confirmUnfreezeDesc', { name: toggleUser?.name || toggleUser?.email || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleUser && handleToggle(toggleUser)}
              disabled={actionLoading[toggleUser?.id ?? '']}
            >
              {actionLoading[toggleUser?.id ?? ''] && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
