import { ShieldX } from 'lucide-react';

export function NoPermission({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <ShieldX className="h-12 w-12 text-zinc-400 dark:text-zinc-500" />
      <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  );
}
