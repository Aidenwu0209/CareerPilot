'use client';

import { Download, FileText } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';

export function CareerReportExport() {
  const locale = useLocale();
  const zh = locale.startsWith('zh');
  return (
    <div className="flex w-full gap-2 sm:w-auto">
      <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
        <a href={`/api/career/report/export?format=markdown&locale=${encodeURIComponent(locale)}`} download><FileText className="h-4 w-4" />Markdown</a>
      </Button>
      <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
        <a href={`/api/career/report/export?format=pdf&locale=${encodeURIComponent(locale)}`} download><Download className="h-4 w-4" />{zh ? '导出 PDF' : 'Export PDF'}</a>
      </Button>
    </div>
  );
}
