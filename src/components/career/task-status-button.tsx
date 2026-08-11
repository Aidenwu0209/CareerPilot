'use client';

import { useState } from 'react';
import { Check, Loader2, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import type { CareerTaskStatus } from '@/types/career';
import { Button } from '@/components/ui/button';

export function TaskStatusButton({
  taskId,
  currentStatus,
}: {
  taskId: string;
  currentStatus: CareerTaskStatus;
}) {
  const t = useTranslations('career');
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const nextStatus: CareerTaskStatus | null =
    currentStatus === 'todo' ? 'in_progress' : currentStatus === 'in_progress' ? 'completed' : null;

  if (!nextStatus) return null;

  async function update() {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/career/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) throw new Error('update_failed');
      toast.success(t(nextStatus === 'in_progress' ? 'path.taskStarted' : 'path.taskCompleted'));
      router.refresh();
    } catch {
      toast.error(t('path.taskUpdateFailed'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant={nextStatus === 'completed' ? 'default' : 'outline'}
      size="sm"
      disabled={isSaving}
      onClick={update}
      className={nextStatus === 'completed' ? 'bg-brand hover:bg-brand-hover' : ''}
    >
      {isSaving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : nextStatus === 'completed' ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Play className="h-4 w-4" aria-hidden="true" />
      )}
      {t(nextStatus === 'completed' ? 'path.completeTask' : 'path.startTask')}
    </Button>
  );
}
