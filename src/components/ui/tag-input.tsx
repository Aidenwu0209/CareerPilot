'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function normalizeTags(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  ariaLabel,
  removeLabel,
  id,
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  ariaLabel: string;
  removeLabel: (tag: string) => string;
  id?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  const commit = () => {
    const next = normalizeTags([...value, ...draft.split(/[,，、\n]/)]);
    if (next.length !== value.length || next.some((item, index) => item !== value[index])) onChange(next);
    setDraft('');
  };

  return (
    <div className={cn('flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50', className)}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pl-2.5 pr-1 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            aria-label={removeLabel(tag)}
            className="inline-flex size-6 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        list={suggestions.length ? listId : undefined}
        aria-label={ariaLabel}
        placeholder={value.length ? undefined : placeholder}
        className="min-w-28 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.filter((item) => !value.includes(item)).map((item) => <option key={item} value={item} />)}
        </datalist>
      )}
    </div>
  );
}
