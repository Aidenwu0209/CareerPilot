'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

type ExportState = 'idle' | 'exporting' | 'success' | 'error';

export function ExportButton() {
  const t = useTranslations('account');
  const [state, setState] = useState<ExportState>('idle');

  const handleExport = async () => {
    if (state === 'exporting') return;
    setState('exporting');
    try {
      const res = await fetch('/api/account/export', { method: 'POST' });
      if (!res.ok) {
        setState('error');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="(.+)"/);
      const filename = filenameMatch
        ? filenameMatch[1]
        : `careerpilot-export-${Date.now()}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState('success');
      setTimeout(() => setState('idle'), 5000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  if (state === 'exporting') {
    return (
      <Button disabled>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('export.exporting')}
      </Button>
    );
  }

  if (state === 'success') {
    return (
      <Button variant="outline" disabled className="text-emerald-600">
        <CheckCircle className="mr-2 h-4 w-4" />
        {t('export.success')}
      </Button>
    );
  }

  if (state === 'error') {
    return (
      <Button variant="outline" disabled className="text-red-600">
        <AlertCircle className="mr-2 h-4 w-4" />
        {t('export.failed')}
      </Button>
    );
  }

  return (
    <Button onClick={handleExport} className="cursor-pointer">
      <Download className="mr-2 h-4 w-4" />
      {t('export.download')}
    </Button>
  );
}
