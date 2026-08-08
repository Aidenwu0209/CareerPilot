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
  Pencil,
  Power,
  AlertCircle,
  Inbox,
  Loader2,
  Coins,
  Cpu,
  ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string;
  providerId: string;
  providerName: string;
  modelIdentifier: string;
  displayName: string;
  capabilities: string[];
  tier: string;
  status: string;
  visibility: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  maxSteps: number | null;
  fixedPrice: number;
  tokenPriceInput: number;
  tokenPriceOutput: number;
}

interface ProviderOption {
  id: string;
  name: string;
  status: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TIERS = [
  { value: 'free', labelKey: 'tierFree' },
  { value: 'standard', labelKey: 'tierStandard' },
  { value: 'premium', labelKey: 'tierPremium' },
];

const VISIBILITIES = [
  { value: 'public', labelKey: 'visibilityPublic' },
  { value: 'internal', labelKey: 'visibilityInternal' },
];

const CAPABILITY_OPTIONS = [
  { value: 'text', labelKey: 'capText', icon: Cpu },
  { value: 'image_generation', labelKey: 'capImage', icon: ImageIcon },
];

const KNOWN_API_ERRORS = new Set([
  'PROVIDER_ID_REQUIRED',
  'MODEL_IDENTIFIER_REQUIRED',
  'DISPLAY_NAME_REQUIRED',
  'PROVIDER_NOT_FOUND',
  'MODEL_IDENTIFIER_EXISTS',
  'INVALID_FIXED_PRICE',
  'INVALID_TOKEN_PRICE_INPUT',
  'INVALID_TOKEN_PRICE_OUTPUT',
  'INVALID_INPUT_TOKEN_LIMIT',
  'INVALID_OUTPUT_TOKEN_LIMIT',
  'INVALID_MAX_STEPS',
  'INVALID_STATUS',
  'MODEL_NOT_FOUND',
  'NO_UPDATES',
  'INVALID_BODY',
]);

// ─── Component ──────────────────────────────────────────────────────────────

export default function AdminAiModelsPage() {
  const t = useTranslations('admin.models');

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Dialog states
  const [addOpen, setAddOpen] = useState(false);
  const [editModel, setEditModel] = useState<ModelInfo | null>(null);
  const [toggleModel, setToggleModel] = useState<ModelInfo | null>(null);

  // Action loading
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [modelsRes, providersRes] = await Promise.all([
        fetch('/api/admin/models'),
        fetch('/api/admin/providers'),
      ]);
      if (!modelsRes.ok) {
        setError(true);
        return;
      }
      const modelsData = await modelsRes.json();
      setModels(modelsData.models ?? []);

      if (providersRes.ok) {
        const providersData = await providersRes.json();
        setProviders(
          (providersData.providers ?? []).map((p: { id: string; name: string; status: string }) => ({
            id: p.id,
            name: p.name,
            status: p.status,
          })),
        );
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setAction = (id: string, loading: boolean) =>
    setActionLoading((prev) => ({ ...prev, [id]: loading }));

  const handleToggle = async (model: ModelInfo) => {
    const newStatus = model.status === 'active' ? 'disabled' : 'active';
    setAction(model.id, true);
    try {
      const res = await fetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        toast.error(t('toggleFailed'));
        return;
      }
      toast.success(newStatus === 'active' ? t('enabled') : t('disabled'));
      fetchData();
    } catch {
      toast.error(t('toggleFailed'));
    } finally {
      setAction(model.id, false);
      setToggleModel(null);
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
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
        </div>
      </div>

      {/* Model list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('loadError')}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchData}>
            {t('retry')}
          </Button>
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white py-12 dark:border-zinc-800 dark:bg-zinc-900">
          <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {models.map((model) => {
            const isActive = model.status === 'active';
            return (
              <div
                key={model.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Left: identity */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {model.displayName}
                      </h3>
                      <Badge variant="outline" className="text-xs">
                        {model.providerName}
                      </Badge>
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {model.modelIdentifier}
                      </code>
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

                    {/* Capabilities + tier + visibility */}
                    <div className="flex flex-wrap items-center gap-2">
                      {model.capabilities.map((cap) => {
                        const opt = CAPABILITY_OPTIONS.find((c) => c.value === cap);
                        const Icon = opt?.icon ?? Cpu;
                        return (
                          <Badge key={cap} variant="secondary" className="gap-1 text-xs">
                            <Icon className="h-3 w-3" />
                            {opt ? t(opt.labelKey) : cap}
                          </Badge>
                        );
                      })}
                      <Badge variant="outline" className="text-xs">
                        {TIERS.find((t_) => t_.value === model.tier)
                          ? t(TIERS.find((t_) => t_.value === model.tier)!.labelKey as Parameters<typeof t>[0])
                          : model.tier}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {model.visibility === 'public' ? t('visibilityPublic') : t('visibilityInternal')}
                      </Badge>
                    </div>

                    {/* Limits + pricing */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {model.inputTokenLimit !== null && (
                        <span>
                          {t('fieldInputLimit')}:{' '}
                          <span className="tabular-nums">{model.inputTokenLimit.toLocaleString()}</span>
                        </span>
                      )}
                      {model.outputTokenLimit !== null && (
                        <span>
                          {t('fieldOutputLimit')}:{' '}
                          <span className="tabular-nums">{model.outputTokenLimit.toLocaleString()}</span>
                        </span>
                      )}
                      {model.maxSteps !== null && (
                        <span>
                          {t('fieldMaxSteps')}:{' '}
                          <span className="tabular-nums">{model.maxSteps}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Coins className="h-3 w-3" />
                        {t('pricingLabel', {
                          fixed: model.fixedPrice,
                          input: model.tokenPriceInput,
                          output: model.tokenPriceOutput,
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setEditModel(model)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setToggleModel(model)}
                      disabled={actionLoading[model.id]}
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

      {/* Add Model Dialog */}
      <AddModelDialog
        providers={providers}
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => {
          setAddOpen(false);
          fetchData();
          toast.success(t('addSuccess'));
        }}
      />

      {/* Edit Model Dialog */}
      <EditModelDialog
        model={editModel}
        onOpenChange={(open) => !open && setEditModel(null)}
        onSuccess={() => {
          setEditModel(null);
          fetchData();
          toast.success(t('editSuccess'));
        }}
      />

      {/* Toggle Status Confirmation */}
      <AlertDialog
        open={!!toggleModel}
        onOpenChange={(open) => !open && setToggleModel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleModel?.status === 'active' ? t('confirmDisable') : t('confirmEnable')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleModel?.status === 'active'
                ? t('confirmDisableDesc')
                : t('confirmEnableDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleModel && handleToggle(toggleModel)}
              disabled={actionLoading[toggleModel?.id ?? '']}
            >
              {actionLoading[toggleModel?.id ?? ''] && (
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

// ─── Capability Toggle ──────────────────────────────────────────────────────

function CapabilityToggle({
  capabilities,
  onChange,
  t,
}: {
  capabilities: string[];
  onChange: (caps: string[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const toggle = (value: string) => {
    if (capabilities.includes(value)) {
      onChange(capabilities.filter((c) => c !== value));
    } else {
      onChange([...capabilities, value]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {CAPABILITY_OPTIONS.map((opt) => {
        const active = capabilities.includes(opt.value);
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ─── Add Model Dialog ───────────────────────────────────────────────────────

function AddModelDialog({
  providers,
  open,
  onOpenChange,
  onSuccess,
}: {
  providers: ProviderOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('admin.models');

  const [providerId, setProviderId] = useState('');
  const [modelIdentifier, setModelIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>(['text']);
  const [tier, setTier] = useState('standard');
  const [visibility, setVisibility] = useState('public');
  const [inputTokenLimit, setInputTokenLimit] = useState('');
  const [outputTokenLimit, setOutputTokenLimit] = useState('');
  const [maxSteps, setMaxSteps] = useState('');
  const [fixedPrice, setFixedPrice] = useState('0');
  const [tokenPriceInput, setTokenPriceInput] = useState('0');
  const [tokenPriceOutput, setTokenPriceOutput] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const activeProviders = providers.filter((p) => p.status === 'active');

  const reset = () => {
    setProviderId('');
    setModelIdentifier('');
    setDisplayName('');
    setCapabilities(['text']);
    setTier('standard');
    setVisibility('public');
    setInputTokenLimit('');
    setOutputTokenLimit('');
    setMaxSteps('');
    setFixedPrice('0');
    setTokenPriceInput('0');
    setTokenPriceOutput('0');
    setFieldError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    if (!providerId) {
      setFieldError(t('errProviderRequired'));
      return;
    }
    if (!modelIdentifier.trim()) {
      setFieldError(t('errIdentifierRequired'));
      return;
    }
    if (!displayName.trim()) {
      setFieldError(t('errNameRequired'));
      return;
    }

    // Validate numeric fields
    const body: Record<string, unknown> = {
      providerId,
      modelIdentifier: modelIdentifier.trim(),
      displayName: displayName.trim(),
      capabilities,
      tier,
      visibility,
      status: 'active',
    };

    if (inputTokenLimit.trim()) {
      const val = Number(inputTokenLimit);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidInputLimit'));
        return;
      }
      body.inputTokenLimit = val;
    }
    if (outputTokenLimit.trim()) {
      const val = Number(outputTokenLimit);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidOutputLimit'));
        return;
      }
      body.outputTokenLimit = val;
    }
    if (maxSteps.trim()) {
      const val = Number(maxSteps);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidMaxSteps'));
        return;
      }
      body.maxSteps = val;
    }

    const fp = Number(fixedPrice);
    const tpi = Number(tokenPriceInput);
    const tpo = Number(tokenPriceOutput);
    if (isNaN(fp) || fp < 0) {
      setFieldError(t('errInvalidFixedPrice'));
      return;
    }
    if (isNaN(tpi) || tpi < 0) {
      setFieldError(t('errInvalidTokenPriceInput'));
      return;
    }
    if (isNaN(tpo) || tpo < 0) {
      setFieldError(t('errInvalidTokenPriceOutput'));
      return;
    }
    body.fixedPrice = fp;
    body.tokenPriceInput = tpi;
    body.tokenPriceOutput = tpo;

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider */}
          <div className="space-y-2">
            <Label>{t('fieldProvider')}</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder={t('fieldProviderPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {activeProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model identifier */}
          <div className="space-y-2">
            <Label>{t('fieldIdentifier')}</Label>
            <Input
              value={modelIdentifier}
              onChange={(e) => setModelIdentifier(e.target.value)}
              placeholder="gpt-4o, claude-sonnet-4-6..."
              maxLength={100}
            />
          </div>

          {/* Display name */}
          <div className="space-y-2">
            <Label>{t('fieldDisplayName')}</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="GPT-4o"
              maxLength={100}
            />
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <Label>{t('fieldCapabilities')}</Label>
            <CapabilityToggle capabilities={capabilities} onChange={setCapabilities} t={t} />
          </div>

          {/* Tier + Visibility */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('fieldTier')}</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t_) => (
                    <SelectItem key={t_.value} value={t_.value}>
                      {t(t_.labelKey as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('fieldVisibility')}</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITIES.map((v_) => (
                    <SelectItem key={v_.value} value={v_.value}>
                      {t(v_.labelKey as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>
                {t('fieldInputLimit')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={inputTokenLimit}
                onChange={(e) => setInputTokenLimit(e.target.value)}
                placeholder="128000"
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('fieldOutputLimit')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={outputTokenLimit}
                onChange={(e) => setOutputTokenLimit(e.target.value)}
                placeholder="16384"
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('fieldMaxSteps')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={maxSteps}
                onChange={(e) => setMaxSteps(e.target.value)}
                placeholder="50"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('fieldFixedPrice')}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={fixedPrice}
                onChange={(e) => setFixedPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('fieldTokenPriceInput')}</Label>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={tokenPriceInput}
                onChange={(e) => setTokenPriceInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('fieldTokenPriceOutput')}</Label>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={tokenPriceOutput}
                onChange={(e) => setTokenPriceOutput(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-400">{t('pricingHint')}</p>

          {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
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

// ─── Edit Model Dialog ──────────────────────────────────────────────────────

function EditModelDialog({
  model,
  onOpenChange,
  onSuccess,
}: {
  model: ModelInfo | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('admin.models');

  const [displayName, setDisplayName] = useState('');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [tier, setTier] = useState('standard');
  const [visibility, setVisibility] = useState('public');
  const [inputTokenLimit, setInputTokenLimit] = useState('');
  const [outputTokenLimit, setOutputTokenLimit] = useState('');
  const [maxSteps, setMaxSteps] = useState('');
  const [fixedPrice, setFixedPrice] = useState('0');
  const [tokenPriceInput, setTokenPriceInput] = useState('0');
  const [tokenPriceOutput, setTokenPriceOutput] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (model) {
      setDisplayName(model.displayName);
      setCapabilities(model.capabilities);
      setTier(model.tier);
      setVisibility(model.visibility);
      setInputTokenLimit(model.inputTokenLimit?.toString() ?? '');
      setOutputTokenLimit(model.outputTokenLimit?.toString() ?? '');
      setMaxSteps(model.maxSteps?.toString() ?? '');
      setFixedPrice(model.fixedPrice.toString());
      setTokenPriceInput(model.tokenPriceInput.toString());
      setTokenPriceOutput(model.tokenPriceOutput.toString());
      setFieldError(null);
    }
  }, [model]);

  if (!model) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    if (!displayName.trim()) {
      setFieldError(t('errNameRequired'));
      return;
    }

    const body: Record<string, unknown> = {
      displayName: displayName.trim(),
      capabilities,
      tier,
      visibility,
    };

    if (inputTokenLimit.trim()) {
      const val = Number(inputTokenLimit);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidInputLimit'));
        return;
      }
      body.inputTokenLimit = val;
    } else {
      body.inputTokenLimit = null;
    }
    if (outputTokenLimit.trim()) {
      const val = Number(outputTokenLimit);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidOutputLimit'));
        return;
      }
      body.outputTokenLimit = val;
    } else {
      body.outputTokenLimit = null;
    }
    if (maxSteps.trim()) {
      const val = Number(maxSteps);
      if (isNaN(val) || val < 0) {
        setFieldError(t('errInvalidMaxSteps'));
        return;
      }
      body.maxSteps = val;
    } else {
      body.maxSteps = null;
    }

    const fp = Number(fixedPrice);
    const tpi = Number(tokenPriceInput);
    const tpo = Number(tokenPriceOutput);
    if (isNaN(fp) || fp < 0) {
      setFieldError(t('errInvalidFixedPrice'));
      return;
    }
    if (isNaN(tpi) || tpi < 0) {
      setFieldError(t('errInvalidTokenPriceInput'));
      return;
    }
    if (isNaN(tpo) || tpo < 0) {
      setFieldError(t('errInvalidTokenPriceOutput'));
      return;
    }
    body.fixedPrice = fp;
    body.tokenPriceInput = tpi;
    body.tokenPriceOutput = tpo;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error && KNOWN_API_ERRORS.has(data.error)
          ? t(`errApi.${data.error}`)
          : t('errEditFailed');
        setFieldError(msg);
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
    <Dialog open={!!model} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>
            {t('editDescription', { name: model.displayName, provider: model.providerName })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Read-only identifier */}
          <div className="space-y-2">
            <Label>{t('fieldIdentifier')}</Label>
            <Input value={model.modelIdentifier} disabled className="bg-zinc-50 dark:bg-zinc-800" />
          </div>

          {/* Display name */}
          <div className="space-y-2">
            <Label>{t('fieldDisplayName')}</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <Label>{t('fieldCapabilities')}</Label>
            <CapabilityToggle capabilities={capabilities} onChange={setCapabilities} t={t} />
          </div>

          {/* Tier + Visibility */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('fieldTier')}</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t_) => (
                    <SelectItem key={t_.value} value={t_.value}>
                      {t(t_.labelKey as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('fieldVisibility')}</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITIES.map((v_) => (
                    <SelectItem key={v_.value} value={v_.value}>
                      {t(v_.labelKey as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>
                {t('fieldInputLimit')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={inputTokenLimit}
                onChange={(e) => setInputTokenLimit(e.target.value)}
                placeholder="128000"
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('fieldOutputLimit')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={outputTokenLimit}
                onChange={(e) => setOutputTokenLimit(e.target.value)}
                placeholder="16384"
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('fieldMaxSteps')}{' '}
                <span className="text-xs text-zinc-400">({t('optional')})</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={maxSteps}
                onChange={(e) => setMaxSteps(e.target.value)}
                placeholder="50"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('fieldFixedPrice')}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={fixedPrice}
                onChange={(e) => setFixedPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('fieldTokenPriceInput')}</Label>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={tokenPriceInput}
                onChange={(e) => setTokenPriceInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('fieldTokenPriceOutput')}</Label>
              <Input
                type="number"
                min={0}
                step="0.0001"
                value={tokenPriceOutput}
                onChange={(e) => setTokenPriceOutput(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-400">{t('pricingHint')}</p>

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
