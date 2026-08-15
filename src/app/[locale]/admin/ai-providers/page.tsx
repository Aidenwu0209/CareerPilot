'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus,
  RefreshCw,
  Plug,
  Power,
  KeyRound,
  Pencil,
  AlertCircle,
  Inbox,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProviderInfo {
  id: string;
  type: string;
  name: string;
  status: string;
  baseUrl: string | null;
  maskedCredential: string | null;
  hasCredentials: boolean;
  credentialVersion: number;
  lastValidatedAt: string | null;
}

interface TestResult {
  result: 'success' | 'failed';
  httpStatus?: number;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google AI' },
  { value: 'ernie', label: 'ERNIE / Qianfan' },
];

const KNOWN_API_ERRORS = new Set([
  'TYPE_REQUIRED',
  'NAME_REQUIRED',
  'INVALID_NAME',
  'UPSTREAM_URL_NOT_ALLOWED',
  'NEW_KEY_REQUIRED',
  'PROVIDER_NOT_FOUND',
  'NO_UPDATES',
  'INVALID_STATUS',
  'INVALID_BODY',
  'KEY_NOT_AVAILABLE',
]);

function providerTypeLabel(type: string): string {
  return PROVIDER_TYPES.find((p) => p.value === type)?.label ?? type;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminAiProvidersPage() {
  const t = useTranslations('admin.providers');

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Dialog states
  const [addOpen, setAddOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<ProviderInfo | null>(null);
  const [rotateProvider, setRotateProvider] = useState<ProviderInfo | null>(null);
  const [toggleProvider, setToggleProvider] = useState<ProviderInfo | null>(null);

  // Per-provider test status
  const [testStatus, setTestStatus] = useState<Record<string, TestResult | 'testing'>>({});

  // Action loading states
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/admin/providers');
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setProviders(data.providers ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const setAction = (id: string, loading: boolean) =>
    setActionLoading((prev) => ({ ...prev, [id]: loading }));

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleTest = async (provider: ProviderInfo) => {
    setTestStatus((prev) => ({ ...prev, [provider.id]: 'testing' }));
    try {
      const res = await fetch(`/api/admin/providers/${provider.id}/test`, { method: 'POST' });
      const data: TestResult = await res.json();
      setTestStatus((prev) => ({ ...prev, [provider.id]: data }));
      if (data.result === 'success') {
        toast.success(t('testSuccess'));
      } else {
        toast.error(t('testFailed'));
      }
      // Refresh to update lastValidatedAt
      fetchProviders();
    } catch {
      setTestStatus((prev) => ({ ...prev, [provider.id]: { result: 'failed', error: 'CONNECTION_ERROR' } }));
      toast.error(t('testFailed'));
    }
  };

  const handleToggle = async (provider: ProviderInfo) => {
    const newStatus = provider.status === 'active' ? 'disabled' : 'active';
    setAction(provider.id, true);
    try {
      const res = await fetch(`/api/admin/providers/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        toast.error(t('toggleFailed'));
        return;
      }
      toast.success(newStatus === 'active' ? t('enabled') : t('disabled'));
      fetchProviders();
    } catch {
      toast.error(t('toggleFailed'));
    } finally {
      setAction(provider.id, false);
      setToggleProvider(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t('description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchProviders} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p>{t('setupNotice')}</p>
          <Link
            href="/admin/ai/models"
            className="inline-flex font-medium underline underline-offset-4 hover:no-underline"
          >
            {t('setupModelsLink')}
          </Link>
        </div>
      </div>

      {/* Provider list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchProviders}>
            {t('retry')}
          </Button>
        </div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => {
            const ts = testStatus[provider.id];
            const isActive = provider.status === 'active';

            return (
              <div
                key={provider.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left: identity */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {provider.name}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        {providerTypeLabel(provider.type)}
                      </Badge>
                      <Badge
                        variant={isActive ? 'default' : 'secondary'}
                        className={cn(
                          'text-xs',
                          isActive
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                        )}
                      >
                        {isActive ? t('statusActive') : t('statusDisabled')}
                      </Badge>
                    </div>

                    {/* Credential info */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>
                        {t('credential')}:{' '}
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
                          {provider.maskedCredential ?? t('noCredential')}
                        </code>
                      </span>
                      <span>
                        {t('version')}:{' '}
                        <span className="tabular-nums">v{provider.credentialVersion}</span>
                      </span>
                      <span>
                        {t('lastValidated')}:{' '}
                        <span>{formatDateTime(provider.lastValidatedAt)}</span>
                      </span>
                      {provider.baseUrl && (
                        <span className="truncate">
                          URL:{' '}
                          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-zinc-800">
                            {provider.baseUrl}
                          </code>
                        </span>
                      )}
                    </div>

                    {/* Test result badge */}
                    {ts && ts !== 'testing' && (
                      <div
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                          ts.result === 'success'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
                        )}
                      >
                        {ts.result === 'success' ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        {ts.result === 'success'
                          ? t('testResultSuccess')
                          : t('testResultFailed')}
                        {ts.httpStatus && (
                          <span className="opacity-60">({ts.httpStatus})</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => handleTest(provider)}
                      disabled={ts === 'testing' || !provider.hasCredentials}
                    >
                      {ts === 'testing' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plug className="h-3.5 w-3.5" />
                      )}
                      {t('test')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setEditProvider(provider)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setRotateProvider(provider)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {t('rotate')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setToggleProvider(provider)}
                      disabled={actionLoading[provider.id]}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {isActive ? t('disable') : t('enable')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Provider Dialog */}
      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => {
          setAddOpen(false);
          fetchProviders();
          toast.success(t('addSuccess'));
        }}
      />

      {/* Edit Provider Dialog */}
      <EditProviderDialog
        provider={editProvider}
        onOpenChange={(open) => !open && setEditProvider(null)}
        onSuccess={() => {
          setEditProvider(null);
          fetchProviders();
          toast.success(t('editSuccess'));
        }}
      />

      {/* Rotate Credential Dialog */}
      <RotateCredentialDialog
        provider={rotateProvider}
        onOpenChange={(open) => !open && setRotateProvider(null)}
        onSuccess={() => {
          setRotateProvider(null);
          fetchProviders();
          toast.success(t('rotateSuccess'));
        }}
      />

      {/* Toggle Status Confirmation */}
      <AlertDialog
        open={!!toggleProvider}
        onOpenChange={(open) => !open && setToggleProvider(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleProvider?.status === 'active' ? t('confirmDisable') : t('confirmEnable')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleProvider?.status === 'active'
                ? t('confirmDisableDesc')
                : t('confirmEnableDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleProvider && handleToggle(toggleProvider)}
              disabled={actionLoading[toggleProvider?.id ?? '']}
            >
              {actionLoading[toggleProvider?.id ?? ''] && (
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

// ─── Add Provider Dialog ────────────────────────────────────────────────────

function AddProviderDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('admin.providers');
  const [type, setType] = useState('openai');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const reset = () => {
    setType('openai');
    setName('');
    setBaseUrl('');
    setCredential('');
    setFieldError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    if (!name.trim()) {
      setFieldError(t('errNameRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          baseUrl: baseUrl.trim() || undefined,
          credential: credential.trim() || undefined,
          status: 'active',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error && KNOWN_API_ERRORS.has(data.error)
          ? t(`errApi.${data.error}`)
          : t('errAddFailed');
        setFieldError(msg);
        return;
      }
      reset();
      onSuccess();
    } catch {
      setFieldError(t('errAddFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('fieldType')}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('fieldName')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OpenAI Production"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t('fieldBaseUrl')}{' '}
              <span className="text-xs text-zinc-400">({t('optional')})</span>
            </Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t('fieldCredential')}{' '}
              <span className="text-xs text-zinc-400">({t('optional')})</span>
            </Label>
            <Input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="sk-..."
            />
            <p className="text-xs text-zinc-400">{t('credentialHint')}</p>
          </div>
          {fieldError && (
            <p className="text-sm text-red-500">{fieldError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Provider Dialog ───────────────────────────────────────────────────

function EditProviderDialog({
  provider,
  onOpenChange,
  onSuccess,
}: {
  provider: ProviderInfo | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('admin.providers');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl ?? '');
      setFieldError(null);
    }
  }, [provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setFieldError(null);

    if (!name.trim()) {
      setFieldError(t('errNameRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (baseUrl.trim() !== (provider.baseUrl ?? '')) {
        body.baseUrl = baseUrl.trim() || null;
      }

      const res = await fetch(`/api/admin/providers/${provider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFieldError(data.error && KNOWN_API_ERRORS.has(data.error) ? t(`errApi.${data.error}`) : t('errEditFailed'));
        return;
      }
      onSuccess();
    } catch {
      setFieldError(t('errEditFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('fieldName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>{t('fieldBaseUrl')}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
            />
          </div>
          {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rotate Credential Dialog ───────────────────────────────────────────────

function RotateCredentialDialog({
  provider,
  onOpenChange,
  onSuccess,
}: {
  provider: ProviderInfo | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('admin.providers');
  const [newKey, setNewKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (provider) {
      setNewKey('');
      setFieldError(null);
    }
  }, [provider]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setFieldError(null);

    if (!newKey.trim()) {
      setFieldError(t('errKeyRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/providers/${provider.id}/credentials/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newKey: newKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFieldError(data.error && KNOWN_API_ERRORS.has(data.error) ? t(`errApi.${data.error}`) : t('errRotateFailed'));
        return;
      }
      onSuccess();
    } catch {
      setFieldError(t('errRotateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('rotateTitle')}</DialogTitle>
          <DialogDescription>
            {t('rotateDescription', { name: provider?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('fieldNewKey')}</Label>
            <Input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="new-password"
            />
            <p className="text-xs text-zinc-400">{t('rotateHint')}</p>
          </div>
          {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('rotateSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
