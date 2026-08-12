'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface EvidenceReviewFormProps {
  studentId: string;
  evidenceId: string;
  copy: {
    trigger: string;
    title: string;
    description: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    decisionLabel: string;
    confirmDecision: string;
    rejectDecision: string;
    scoreLabel: string;
    scoreHelp: string;
    scorePlaceholder: string;
    confirm: string;
    reject: string;
    submitting: string;
    success: string;
    error: string;
  };
}

export function EvidenceReviewForm({ studentId, evidenceId, copy }: EvidenceReviewFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [decision, setDecision] = useState<'confirmed' | 'rejected'>('confirmed');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const score = Number(form.get('score'));
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}/evidence/${encodeURIComponent(evidenceId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            reason: String(form.get('reason') ?? ''),
            ...(decision === 'confirmed' ? { score } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      toast.success(copy.success);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(copy.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">{copy.trigger}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{copy.decisionLabel}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={decision === 'confirmed' ? 'default' : 'outline'}
                aria-pressed={decision === 'confirmed'}
                onClick={() => setDecision('confirmed')}
              >
                {copy.confirmDecision}
              </Button>
              <Button
                type="button"
                variant={decision === 'rejected' ? 'destructive' : 'outline'}
                aria-pressed={decision === 'rejected'}
                onClick={() => setDecision('rejected')}
              >
                {copy.rejectDecision}
              </Button>
            </div>
          </fieldset>

          {decision === 'confirmed' ? (
            <div className="space-y-2">
              <Label htmlFor={`evidence-score-${evidenceId}`}>{copy.scoreLabel}</Label>
              <Input
                id={`evidence-score-${evidenceId}`}
                name="score"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                required
                placeholder={copy.scorePlaceholder}
              />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{copy.scoreHelp}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`evidence-reason-${evidenceId}`}>{copy.reasonLabel}</Label>
            <Textarea
              id={`evidence-reason-${evidenceId}`}
              name="reason"
              required
              minLength={2}
              maxLength={1000}
              rows={4}
              placeholder={copy.reasonPlaceholder}
            />
          </div>
          <Button type="submit" variant={decision === 'confirmed' ? 'default' : 'destructive'} disabled={submitting}>
            {submitting ? copy.submitting : decision === 'confirmed' ? copy.confirm : copy.reject}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
