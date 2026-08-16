'use client';

import { useState, useCallback } from 'react';
import { logger } from '@/lib/observability/logger';

export function usePdfExport() {
  const [isExporting, setIsExporting] = useState(false);

  const exportPdf = useCallback(async (resumeId: string, title?: string) => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/resume/${resumeId}/export?format=pdf`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'PDF export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'resume'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('client.resume_pdf_export_failed', { error, resumeId });
      throw error;
    } finally {
      setIsExporting(false);
    }
  }, []);

  return { exportPdf, isExporting };
}
