import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/routing';

export function Breadcrumbs({
  items,
  label = 'Breadcrumb',
}: {
  items: Array<{ label: string; href?: string }>;
  label?: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.href ?? 'current'}-${item.label}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-4 text-zinc-500" aria-hidden="true" />}
              {item.href && !current ? (
                <Link href={item.href} className="rounded-sm hover:text-zinc-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-white">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={current ? 'page' : undefined} className={current ? 'font-medium text-zinc-900 dark:text-zinc-100' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
