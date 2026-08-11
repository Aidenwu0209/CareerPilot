'use client';

import { ClipboardPlus, MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface ActionFormCopy {
  guidance: {
    trigger: string;
    title: string;
    description: string;
    visibilityLabel: string;
    studentVisible: string;
    privateNote: string;
    contentLabel: string;
    contentPlaceholder: string;
    submit: string;
  };
  task: {
    trigger: string;
    title: string;
    description: string;
    nameLabel: string;
    namePlaceholder: string;
    abilityLabel: string;
    dueDateLabel: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    criteriaLabel: string;
    criteriaPlaceholder: string;
    submit: string;
  };
  submitting: string;
  success: string;
  error: string;
}

async function submitJson(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
}

export function TeacherActionForms({
  studentId,
  abilities,
  copy,
}: {
  studentId: string;
  abilities: Array<{ key: string; name: string }>;
  copy: ActionFormCopy;
}) {
  const router = useRouter();
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitGuidance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await submitJson(`/api/teacher/students/${encodeURIComponent(studentId)}/guidance`, {
        visibility: String(form.get('visibility') ?? 'student'),
        content: String(form.get('content') ?? ''),
      });
      toast.success(copy.success);
      setGuidanceOpen(false);
      router.refresh();
    } catch {
      toast.error(copy.error);
    } finally {
      setSubmitting(false);
    }
  };

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await submitJson(`/api/teacher/students/${encodeURIComponent(studentId)}/tasks`, {
        title: String(form.get('title') ?? ''),
        abilityKey: String(form.get('abilityKey') ?? ''),
        dueDate: String(form.get('dueDate') ?? ''),
        reason: String(form.get('reason') ?? ''),
        completionCriteria: String(form.get('completionCriteria') ?? ''),
      });
      toast.success(copy.success);
      setTaskOpen(false);
      router.refresh();
    } catch {
      toast.error(copy.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
      <Dialog open={guidanceOpen} onOpenChange={setGuidanceOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full sm:w-auto">
            <MessageSquarePlus aria-hidden="true" className="size-4" />
            {copy.guidance.trigger}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.guidance.title}</DialogTitle>
            <DialogDescription>{copy.guidance.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitGuidance} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="guidance-visibility">{copy.guidance.visibilityLabel}</Label>
              <Select name="visibility" defaultValue="student">
                <SelectTrigger id="guidance-visibility" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">{copy.guidance.studentVisible}</SelectItem>
                  <SelectItem value="private">{copy.guidance.privateNote}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="guidance-content">{copy.guidance.contentLabel}</Label>
              <Textarea
                id="guidance-content"
                name="content"
                required
                minLength={2}
                maxLength={2000}
                rows={6}
                placeholder={copy.guidance.contentPlaceholder}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? copy.submitting : copy.guidance.submit}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogTrigger asChild>
          <Button className="w-full sm:w-auto">
            <ClipboardPlus aria-hidden="true" className="size-4" />
            {copy.task.trigger}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{copy.task.title}</DialogTitle>
            <DialogDescription>{copy.task.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitTask} className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="task-title">{copy.task.nameLabel}</Label>
              <Input id="task-title" name="title" required maxLength={120} placeholder={copy.task.namePlaceholder} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="task-ability">{copy.task.abilityLabel}</Label>
              <Select name="abilityKey" required>
                <SelectTrigger id="task-ability" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {abilities.map((ability) => (
                    <SelectItem key={ability.key} value={ability.key}>{ability.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due-date">{copy.task.dueDateLabel}</Label>
              <Input id="task-due-date" name="dueDate" type="date" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="task-reason">{copy.task.reasonLabel}</Label>
              <Textarea id="task-reason" name="reason" required rows={3} maxLength={1000} placeholder={copy.task.reasonPlaceholder} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="task-criteria">{copy.task.criteriaLabel}</Label>
              <Textarea
                id="task-criteria"
                name="completionCriteria"
                required
                rows={3}
                maxLength={1000}
                placeholder={copy.task.criteriaPlaceholder}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full sm:col-span-2 sm:w-auto">
              {submitting ? copy.submitting : copy.task.submit}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { ActionFormCopy };
