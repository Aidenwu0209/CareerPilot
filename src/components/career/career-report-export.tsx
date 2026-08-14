'use client';

import { ChevronDown, Download, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function CareerReportExport() {
  const locale = useLocale();
  const t = useTranslations('career.reportExport');
  const href = (format: 'markdown' | 'pdf' | 'docx') =>
    `/api/career/report/export?format=${format}&locale=${encodeURIComponent(locale)}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full sm:w-auto">
          <Download className="h-4 w-4" />
          {t('action')}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {(['pdf', 'docx', 'markdown'] as const).map((format) => (
          <DropdownMenuItem key={format} asChild>
            <a href={href(format)} download>
              <FileText className="h-4 w-4" />
              {t(format)}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
