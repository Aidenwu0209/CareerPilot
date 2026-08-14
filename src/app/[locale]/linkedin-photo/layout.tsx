import { Header } from '@/components/layout/header';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { AuthGuard } from '@/components/auth/auth-guard';

export default function LinkedInPhotoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
      <SettingsDialog />
    </div>
  );
}
