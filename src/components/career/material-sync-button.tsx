'use client';

import { useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/http/client';

export function MaterialSyncButton({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const t = useTranslations('career.materials');
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  async function sync() {
    setIsSyncing(true);
    try {
      const body = await fetchJson<{
        result?: { processedSources?: number; evidenceCreated?: number; warnings?: string[] };
      }>('/api/career/profile/materials', { method: 'POST' });
      toast.success(t('success', {
        sources: body.result?.processedSources ?? 0,
        evidence: body.result?.evidenceCreated ?? 0,
      }));
      if (body.result?.warnings?.length) toast.warning(t('warning'));
      router.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      onClick={sync}
      disabled={isSyncing}
      className={variant === 'default' ? 'w-full bg-brand hover:bg-brand-hover sm:w-auto' : 'w-full sm:w-auto'}
    >
      {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
      {isSyncing ? t('syncing') : t('action')}
    </Button>
  );
}
