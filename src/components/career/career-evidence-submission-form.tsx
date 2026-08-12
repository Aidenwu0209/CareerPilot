'use client';

import { FormEvent, useState } from 'react';
import { FilePlus2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type EvidenceRequirement = {
  abilityCode: string;
  abilityName: string;
  required: boolean;
  description: string;
};

export function CareerEvidenceSubmissionForm({
  occupationCode,
  occupationName,
  requirements,
  defaultAbilityCode,
  variant = 'outline',
}: {
  occupationCode: string;
  occupationName: string;
  requirements: EvidenceRequirement[];
  defaultAbilityCode?: string;
  variant?: 'default' | 'outline';
}) {
  const t = useTranslations('career.evidenceSubmission');
  const router = useRouter();
  const initialAbilityCode = requirements.some((item) => item.abilityCode === defaultAbilityCode)
    ? defaultAbilityCode!
    : requirements[0]?.abilityCode ?? '';
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [abilityCode, setAbilityCode] = useState(initialAbilityCode);

  if (requirements.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSubmitting(true);
    try {
      const sourceUrl = String(form.get('sourceUrl') ?? '').trim();
      const response = await fetch('/api/career/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occupationCode,
          abilityCode,
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          ...(sourceUrl ? { sourceUrl } : {}),
        }),
      });
      if (!response.ok) throw new Error(`evidence_submit_${response.status}`);
      toast.success(t('success'));
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} className="w-full sm:w-auto">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          {t('action')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { occupation: occupationName })}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`career-evidence-ability-${occupationCode}`}>{t('abilityLabel')}</Label>
            <select
              id={`career-evidence-ability-${occupationCode}`}
              name="abilityCode"
              value={abilityCode}
              onChange={(event) => setAbilityCode(event.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 dark:text-zinc-100"
            >
              {requirements.map((requirement) => (
                <option key={requirement.abilityCode} value={requirement.abilityCode}>
                  {requirement.abilityName} · {requirement.required ? t('required') : t('preferred')}
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {requirements.find((item) => item.abilityCode === abilityCode)?.description}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`career-evidence-title-${occupationCode}`}>{t('titleLabel')}</Label>
            <Input
              id={`career-evidence-title-${occupationCode}`}
              name="title"
              required
              minLength={2}
              maxLength={160}
              placeholder={t('titlePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`career-evidence-description-${occupationCode}`}>{t('descriptionLabel')}</Label>
            <Textarea
              id={`career-evidence-description-${occupationCode}`}
              name="description"
              required
              minLength={2}
              maxLength={2000}
              rows={5}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`career-evidence-source-${occupationCode}`}>{t('sourceUrlLabel')}</Label>
            <Input
              id={`career-evidence-source-${occupationCode}`}
              name="sourceUrl"
              type="url"
              inputMode="url"
              maxLength={1000}
              placeholder={t('sourceUrlPlaceholder')}
            />
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('reviewNotice')}</p>
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full bg-brand hover:bg-brand-hover sm:w-auto">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
