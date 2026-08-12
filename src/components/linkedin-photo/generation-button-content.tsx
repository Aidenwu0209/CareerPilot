import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GenerationButtonContent({
  isGenerating,
  generateLabel,
  generatingLabel,
}: {
  isGenerating: boolean;
  generateLabel: string;
  generatingLabel: string;
}) {
  return (
    <>
      <Loader2
        aria-hidden="true"
        className={cn('h-5 w-5 animate-spin', !isGenerating && 'hidden')}
      />
      <Sparkles
        aria-hidden="true"
        className={cn('h-5 w-5', isGenerating && 'hidden')}
      />
      <span aria-live="polite">
        {isGenerating ? generatingLabel : generateLabel}
      </span>
    </>
  );
}
