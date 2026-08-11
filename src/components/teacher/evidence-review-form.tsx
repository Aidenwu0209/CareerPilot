'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
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
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/teacher/students/${encodeURIComponent(studentId)}/evidence/${encodeURIComponent(evidenceId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, reason: String(form.get('reason') ?? '') }),
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
          <div className="grid gap-2 sm:flex">
            <Button type="submit" disabled={submitting} onClick={() => setDecision('confirmed')}>
              {submitting && decision === 'confirmed' ? copy.submitting : copy.confirm}
            </Button>
            <Button type="submit" variant="destructive" disabled={submitting} onClick={() => setDecision('rejected')}>
              {submitting && decision === 'rejected' ? copy.submitting : copy.reject}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
