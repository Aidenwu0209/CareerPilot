import { redirect } from 'next/navigation';
import { resolveServerContext } from '@/lib/auth/server-context';
import { userRepository } from '@/lib/db/repositories/user.repository';
import {
  isOnboardingRequired,
} from '@/lib/auth/onboarding';
import { normalizeInternalCallbackUrl } from '@/lib/auth/login-redirect';

export default async function AuthCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const callbackUrl = normalizeInternalCallbackUrl(
    query.callbackUrl,
    `/${locale}/dashboard`,
  );
  const context = await resolveServerContext();
  if (!context) {
    redirect(`/${locale}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const user = await userRepository.findById(context.actor.userId);
  if (user && isOnboardingRequired(user.settings)) {
    redirect(`/${locale}/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  redirect(callbackUrl);
}
