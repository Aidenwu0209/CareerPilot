'use client';

import { LayoutDashboard, Users, BarChart3, GraduationCap, Menu, Palette } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  i18nKey: string;
  match: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/org-admin', i18nKey: 'orgAdmin.overview', match: '/org-admin', icon: LayoutDashboard, exact: true },
  { href: '/org-admin/members', i18nKey: 'orgAdmin.sections.members.title', match: '/org-admin/members', icon: Users },
  { href: '/org-admin/usage', i18nKey: 'orgAdmin.sections.usage.title', match: '/org-admin/usage', icon: BarChart3 },
  { href: '/org-admin/branding', i18nKey: 'orgAdmin.sections.branding.title', match: '/org-admin/branding', icon: Palette },
  { href: '/org-admin/school', i18nKey: 'orgAdmin.sections.school.title', match: '/org-admin/school', icon: GraduationCap },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = item.exact ? pathname === item.match : pathname.startsWith(item.match);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{t(item.i18nKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function OrgAdminSidebar() {
  const t = useTranslations();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 md:block">
        <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] flex-col p-4">
          <h2 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {t('orgAdmin.title')}
          </h2>
          <NavList />
        </div>
      </aside>

      {/* Mobile menu */}
      <div className="md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Menu className="h-4 w-4" />
              {t('orgAdmin.title')}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <div className="pt-6">
              <h2 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {t('orgAdmin.title')}
              </h2>
              <NavList onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
