'use client';

import Image from 'next/image';
import { Settings, Menu } from 'lucide-react';
import { LocaleSwitcher } from './locale-switcher';
import { UserMenu } from './user-menu';
import { NavBalance } from './nav-balance';
import { Link, usePathname } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';
import { useTranslations } from 'next-intl';
import { useNavContext } from '@/hooks/use-nav-context';
import { cn } from '@/lib/utils';
import { useBrand } from './brand-provider';

const NAV_ITEMS: { href: string; i18nKey: string; match: string; tourId?: string }[] = [
  { href: '/dashboard', i18nKey: 'dashboard.nav', match: '/dashboard' },
  { href: '/templates', i18nKey: 'templates.nav', match: '/templates', tourId: 'dash-templates' },
  { href: '/interview', i18nKey: 'interview.nav', match: '/interview' },
];

export function Header() {
  const { openModal } = useUIStore();
  const t = useTranslations();
  const pathname = usePathname();
  const { navContext } = useNavContext();
  const { branding } = useBrand();

  // Build role-based nav items
  const roleItems: { href: string; i18nKey: string; match: string }[] = [];
  if (navContext?.platformRole === 'super_admin') {
    roleItems.push({ href: '/admin', i18nKey: 'nav.admin', match: '/admin' });
  }
  if (navContext?.isOrgAdmin) {
    roleItems.push({ href: '/org-admin', i18nKey: 'nav.orgAdmin', match: '/org-admin' });
  }
  const allItems = [...NAV_ITEMS, ...roleItems];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-1">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant-controlled HTTPS/relative logo is validated server-side
              <img src={branding.logoUrl} alt={branding.productName} className="h-9 max-w-40 object-contain" />
            ) : branding.productName !== 'CareerPilot' ? (
              <span className="max-w-40 truncate text-lg font-bold tracking-tight text-brand">{branding.productName}</span>
            ) : (
              <Image
                src="/logo.svg"
                alt="CareerPilot"
                width={280}
                height={48}
                priority
                className="h-auto w-40"
              />
            )}
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {allItems.map((item) => {
              const isActive = pathname.startsWith(item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour={'tourId' in item ? item.tourId : undefined}
                  className={cn(
                    'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  )}
                >
                  {t(item.i18nKey)}
                  {isActive && (
                    <span className="absolute bottom-[-9px] left-1/2 h-[2px] w-4/5 -translate-x-1/2 rounded-full bg-brand" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NavBalance />
          <LocaleSwitcher />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openModal('settings')}
            className="cursor-pointer text-zinc-500"
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <UserMenu />
          {/* Mobile menu */}
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t('common.menu')}>
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <nav className="flex flex-col gap-2 pt-8">
                  {allItems.map((item) => {
                    const isActive = pathname.startsWith(item.match);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-tour={'tourId' in item ? item.tourId : undefined}
                        className={cn(
                          'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                        )}
                      >
                        {t(item.i18nKey)}
                      </Link>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
