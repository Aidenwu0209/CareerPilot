'use client';

import { LayoutDashboard, Menu, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface TeacherSidebarProps {
  copy: {
    label: string;
    menu: string;
    queue: string;
    students: string;
  };
}

const NAV_ITEMS = [
  { href: '/teacher', key: 'queue' as const, icon: LayoutDashboard, exact: true },
  { href: '/teacher/students', key: 'students' as const, icon: UsersRound, exact: false },
];

function TeacherNav({ copy, onNavigate }: TeacherSidebarProps & { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label={copy.label} className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{copy[item.key]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function TeacherSidebar({ copy }: TeacherSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:block">
        <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col p-4">
          <h2 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {copy.label}
          </h2>
          <TeacherNav copy={copy} />
        </div>
      </aside>

      <div className="border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2" aria-label={copy.menu}>
              <Menu aria-hidden="true" className="size-4" />
              {copy.label}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(19rem,85vw)] p-4">
            <SheetTitle className="mb-5 px-3 text-left text-sm">{copy.label}</SheetTitle>
            <TeacherNav copy={copy} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
