'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  Search,
  AlertCircle,
  Inbox,
  Loader2,
  Building2,
  Users,
  Coins,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/routing';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrgAdmin {
  userId: string;
  name: string | null;
  email: string;
}

interface OrgInfo {
  id: string;
  slug: string;
  name: string;
  kind: 'employer' | 'school';
  status: 'active' | 'suspended';
  seatLimit: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  balance: number;
  admins: OrgAdmin[];
}

const KNOWN_API_ERRORS = new Set([
  'INVALID_NAME',
  'INVALID_SLUG',
  'INVALID_SEAT_LIMIT',
  'INVALID_INITIAL_QUOTA',
  'INVALID_STATUS',
  'SLUG_ALREADY_EXISTS',
  'INVALID_BODY',
  'FORBIDDEN',
  'AUTH_REQUIRED',
]);

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminOrganizationsPage() {
  const t = useTranslations('admin.orgs');

  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    kind: 'employer' as 'employer' | 'school',
    seatLimit: '',
    initialQuota: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const fetchOrgs = useCallback(async (q: string) => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const res = await fetch(`/api/admin/organizations?${params.toString()}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setOrgs(data.organizations ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs('');
  }, [fetchOrgs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedQuery(searchQuery.trim());
    fetchOrgs(searchQuery.trim());
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};

    if (!form.name.trim()) {
      errs.name = t('errNameRequired');
    }

    if (!form.slug.trim()) {
      errs.slug = t('errSlugRequired');
    } else if (!/^[a-zA-Z0-9-]+$/.test(form.slug.trim())) {
      errs.slug = t('errSlugFormat');
    }

    const seatNum = parseInt(form.seatLimit, 10);
    if (!Number.isInteger(seatNum) || seatNum < 0) {
      errs.seatLimit = t('errSeatLimitInvalid');
    }

    const quotaNum = parseInt(form.initialQuota, 10);
    if (form.initialQuota !== '' && (!Number.isInteger(quotaNum) || quotaNum < 0)) {
      errs.initialQuota = t('errQuotaInvalid');
    }

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        kind: form.kind,
        seatLimit: parseInt(form.seatLimit, 10),
      };
      if (form.initialQuota !== '') {
        body.initialQuota = parseInt(form.initialQuota, 10);
      }

      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error && KNOWN_API_ERRORS.has(data.error)
          ? t(`errApi.${data.error}`)
          : t('createFailed');
        toast.error(msg);
        return;
      }

      toast.success(t('createSuccess'));
      setCreateOpen(false);
      setForm({ name: '', slug: '', kind: 'employer', seatLimit: '', initialQuota: '' });
      setFormErrors({});
      fetchOrgs(submittedQuery);
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setFormErrors({});
    setCreateOpen(true);
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchOrgs(submittedQuery)} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
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
              fetchOrgs('');
            }}
          >
            {t('clear')}
          </Button>
        )}
      </form>

      {/* Organization list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchOrgs(submittedQuery)}>
            {t('retry')}
          </Button>
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            {submittedQuery ? t('noResults') : t('empty')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => {
            const isActive = org.status === 'active';

            return (
              <div
                key={org.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left: identity */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 text-zinc-400" />
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="truncate text-base font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
                      >
                        {org.name}
                      </Link>
                      <Badge variant="outline" className="text-xs text-zinc-500">
                        {org.slug}
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
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {t('seats')}: {' '}
                        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                          {org.memberCount} / {org.seatLimit}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Coins className="h-3 w-3" />
                        {t('balance')}: {' '}
                        <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                          {org.balance.toLocaleString()}
                        </span>
                      </span>
                    </div>

                    {/* Admins summary */}
                    {org.admins.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{t('admins')}:</span>
                        {org.admins.map((admin, i) => (
                          <span key={admin.userId}>
                            {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">, </span>}
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {admin.name || admin.email}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="org-name">{t('fieldName')}</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('fieldNamePlaceholder')}
              />
              {formErrors.name && (
                <p className="text-xs text-red-500">{formErrors.name}</p>
              )}
            </div>

            {/* Slug */}
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">{t('fieldSlug')}</Label>
              <Input
                id="org-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder={t('fieldSlugPlaceholder')}
              />
              {formErrors.slug && (
                <p className="text-xs text-red-500">{formErrors.slug}</p>
              )}
              <p className="text-xs text-zinc-400">{t('fieldSlugHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-kind">{t('fieldKind')}</Label>
              <select id="org-kind" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as 'employer' | 'school' })}>
                <option value="employer">{t('kindEmployer')}</option>
                <option value="school">{t('kindSchool')}</option>
              </select>
            </div>

            {/* Seat Limit */}
            <div className="space-y-1.5">
              <Label htmlFor="org-seats">{t('fieldSeats')}</Label>
              <Input
                id="org-seats"
                type="number"
                min="0"
                value={form.seatLimit}
                onChange={(e) => setForm({ ...form, seatLimit: e.target.value })}
                placeholder="0"
              />
              {formErrors.seatLimit && (
                <p className="text-xs text-red-500">{formErrors.seatLimit}</p>
              )}
            </div>

            {/* Initial Quota */}
            <div className="space-y-1.5">
              <Label htmlFor="org-quota">{t('fieldQuota')}</Label>
              <Input
                id="org-quota"
                type="number"
                min="0"
                value={form.initialQuota}
                onChange={(e) => setForm({ ...form, initialQuota: e.target.value })}
                placeholder="0"
              />
              {formErrors.initialQuota && (
                <p className="text-xs text-red-500">{formErrors.initialQuota}</p>
              )}
              <p className="text-xs text-zinc-400">{t('fieldQuotaHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
