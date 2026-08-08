import { redirect } from 'next/navigation';
import { resolveContext } from '@/lib/auth/context';
import { Header } from '@/components/layout/header';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { NoPermission } from '@/components/admin/no-permission';
import { getTranslations } from 'next-intl/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveContext();
  const t = await getTranslations('admin');

  if (!context) {
    redirect('/login?callbackUrl=/admin');
  }

  const isSuperAdmin = context.actor.platformRole === 'super_admin';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <div className="mx-auto flex max-w-7xl">
        {isSuperAdmin ? (
          <>
            <AdminSidebar />
            <main className="min-h-[calc(100vh-3.5rem)] flex-1 px-4 py-8">{children}</main>
          </>
        ) : (
          <main className="mx-auto w-full max-w-2xl px-4 py-16">
            <NoPermission title={t('noPermission.title')} description={t('noPermission.description')} />
          </main>
        )}
      </div>
    </div>
  );
}
