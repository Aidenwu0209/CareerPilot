'use client';

import { useState } from 'react';
import { Flag, Mail, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function MatchReviewFeedback({ occupationCode, occupationName }: {
  occupationCode: string;
  occupationName: string;
}) {
  const t = useTranslations('career.matching.review');
  const [open, setOpen] = useState(false);
  const subject = encodeURIComponent(t('emailSubject', { occupation: occupationName }));
  const body = encodeURIComponent(t('emailBody', { occupation: occupationName, code: occupationCode }));

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" aria-hidden="true" />
        {t('action')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-zinc-50 p-4 text-sm leading-6 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <p>{t('scope')}</p>
            <p className="mt-2 font-medium text-zinc-800 dark:text-zinc-200">{occupationName} · {occupationCode}</p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('notice')}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t('cancel')}
            </Button>
            <Button asChild className="bg-brand hover:bg-brand-hover">
              <a href={`mailto:support@careerpilot.app?subject=${subject}&body=${body}`}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {t('contact')}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
