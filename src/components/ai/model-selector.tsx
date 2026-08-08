'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useModelCatalog,
  estimateCredits,
} from '@/hooks/use-model-catalog';

interface ModelSelectorProps {
  selectedModel?: string;
  onModelChange: (modelId: string) => void;
  /** Optional capability filter — e.g. 'text' or 'image_generation'. */
  capability?: string;
  size?: 'sm' | 'default';
  className?: string;
}

export function ModelSelector({
  selectedModel,
  onModelChange,
  capability,
  size = 'sm',
  className,
}: ModelSelectorProps) {
  const t = useTranslations('ai');
  const { models, loading, error } = useModelCatalog();

  // Filter by capability if specified
  const filtered = capability
    ? models.filter((m) => m.capabilities.includes(capability))
    : models;

  // Detect if the currently selected model is no longer available
  const selectedUnavailable =
    !!selectedModel && filtered.length > 0 && !filtered.some((m) => m.id === selectedModel);
  const prevUnavailable = useRef(false);

  // AC4: When the selected model becomes unavailable (disabled/removed),
  // auto-fallback to the first available model and show a clear notification
  useEffect(() => {
    if (selectedUnavailable && !prevUnavailable.current) {
      prevUnavailable.current = true;
      const fallback = filtered[0];
      if (fallback) {
        onModelChange(fallback.id);
        toast.warning(t('modelUnavailable'), {
          description: fallback.displayName,
        });
      } else {
        toast.warning(t('modelUnavailable'));
      }
    }
    if (!selectedUnavailable) {
      prevUnavailable.current = false;
    }
  }, [selectedUnavailable, filtered, onModelChange, t]);

  // Auto-select first model if nothing is selected
  useEffect(() => {
    if (!selectedModel && filtered.length > 0) {
      onModelChange(filtered[0].id);
    }
  }, [selectedModel, filtered, onModelChange]);

  // Loading state
  if (loading) {
    return (
      <Skeleton
        className={size === 'sm' ? 'h-7 w-24 rounded-full' : 'h-9 w-32 rounded-md'}
      />
    );
  }

  // Error or empty state
  if (error || filtered.length === 0) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] text-zinc-400 ${className ?? ''}`}
        title={error ? t('modelLoadError') : t('noModelsAvailable')}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-300" />
        {error ? t('modelLoadError') : t('noModelsAvailable')}
      </span>
    );
  }

  // Find the selected model object for display
  const selected = filtered.find((m) => m.id === selectedModel);

  return (
    <div className={className}>
      <Select value={selectedModel} onValueChange={onModelChange}>
        <SelectTrigger
          className={`${
            size === 'sm'
              ? 'h-7 max-w-[200px] rounded-full px-2.5 text-[11px]'
              : 'h-9 max-w-[240px] rounded-md px-3 text-sm'
          } gap-1 border-zinc-200 bg-white font-medium text-zinc-600 shadow-none`}
        >
          <span className="mr-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <SelectValue placeholder={t('modelPlaceholder')}>
            {selected ? selected.displayName : t('modelPlaceholder')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {filtered.map((model) => (
            <SelectItem
              key={model.id}
              value={model.id}
              className="flex flex-col items-start gap-1 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{model.displayName}</span>
                {model.tier && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {model.tier}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                {model.providerType && <span>{model.providerType}</span>}
                {estimateCredits(model) !== null && (
                  <span>
                    {estimateCredits(model) === '~'
                      ? t('tokenPriced')
                      : `${estimateCredits(model)} ${t('credits')}`}
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
