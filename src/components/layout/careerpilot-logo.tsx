import Image from 'next/image';
import { cn } from '@/lib/utils';

interface CareerPilotLogoProps {
  compact?: boolean;
  preload?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function CareerPilotLogo({
  compact = false,
  preload = false,
  className,
  markClassName,
  wordmarkClassName,
}: CareerPilotLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Image
        src="/careerpilot-logo.png"
        alt={compact ? 'CareerPilot' : ''}
        width={512}
        height={512}
        preload={preload}
        className={cn(
          'h-10 w-10 shrink-0 rounded-[14px] bg-white object-cover shadow-sm ring-1 ring-sky-100',
          markClassName
        )}
      />
      {!compact && (
        <span
          className={cn(
            'whitespace-nowrap text-lg font-bold tracking-[-0.035em] text-[#27496D] dark:text-sky-50',
            wordmarkClassName
          )}
        >
          Career<span className="text-brand">Pilot</span>
        </span>
      )}
    </span>
  );
}
