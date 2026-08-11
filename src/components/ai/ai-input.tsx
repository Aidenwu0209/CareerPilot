'use client';

import { useTranslations } from 'next-intl';
import { SendHorizonal } from 'lucide-react';
import type { FormEvent, ChangeEvent } from 'react';
import { ModelSelector } from './model-selector';

interface AIInputProps {
  input: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  selectedModel?: string;
  onModelChange: (model: string) => void;
}

export function AIInput({ input, onChange, onSubmit, isLoading, selectedModel, onModelChange }: AIInputProps) {
  const t = useTranslations('ai');

  return (
    <form onSubmit={onSubmit} className="p-3">
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 transition-colors focus-within:border-zinc-300 focus-within:bg-white">
        {/* Textarea */}
        <textarea
          value={input}
          onChange={onChange}
          placeholder={t('placeholder')}
          rows={2}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const form = e.currentTarget.closest('form');
              if (form) form.requestSubmit();
            }
          }}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* Model selector */}
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            capability="text"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 [&:not(:disabled)]:bg-brand [&:not(:disabled)]:text-white [&:not(:disabled)]:hover:bg-brand-hover"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
