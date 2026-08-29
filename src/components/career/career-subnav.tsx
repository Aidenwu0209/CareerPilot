'use client';

import {
  Compass,
  Crosshair,
  GitBranch,
  LayoutDashboard,
  Scale,
  UserRoundSearch,
  ClipboardCheck,
  FileText,
} from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

const icons = {
  overview: LayoutDashboard,
  profile: UserRoundSearch,
  assessment: ClipboardCheck,
  goals: Crosshair,
  jobs: Compass,
  matching: Scale,
  path: GitBranch,
  report: FileText,
} as const;

export type CareerNavItem = {
  key: keyof typeof icons;
  href: string;
  label: string;
};

export function CareerSubnav({ items, label }: { items: CareerNavItem[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-7xl overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-1 py-2">
          {items.map((item) => {
            const Icon = icons[item.key];
            const isActive =
              item.href === '/career'
                ? pathname === '/career'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                  isActive
                    ? 'bg-brand/10 text-brand dark:bg-brand/15'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
