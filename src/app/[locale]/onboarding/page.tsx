import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { resolveServerContext } from '@/lib/auth/server-context';
import { userRepository } from '@/lib/db/repositories/user.repository';
import { isOnboardingRequired } from '@/lib/auth/onboarding';
import { OnboardingForm } from '@/components/auth/onboarding-form';

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const [{ locale }, context, t] = await Promise.all([
    params,
    resolveServerContext(),
    getTranslations('onboarding'),
  ]);
  if (!context) redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(`/${locale}/onboarding`)}`);

  const user = await userRepository.findById(context.actor.userId);
  if (!user || !isOnboardingRequired(user.settings)) redirect(`/${locale}/dashboard`);

  return (
    <main className="min-h-dvh bg-zinc-50 px-4 py-8 sm:py-12 dark:bg-zinc-950">
      <div className="mx-auto max-w-2xl">
        <Image src="/logo.svg" alt="CareerPilot" width={160} height={36} priority />
        <section className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{t('description')}</p>
          <OnboardingForm defaultName={user.name ?? ''} />
        </section>
      </div>
    </main>
  );
}
