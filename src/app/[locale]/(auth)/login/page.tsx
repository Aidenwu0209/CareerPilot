import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LoginButton } from '@/components/auth/login-button';
import { EmailOtpLogin } from '@/components/auth/email-otp-login';
import { PasswordAuthForm } from '@/components/auth/password-auth-form';
import { Separator } from '@/components/ui/separator';
import { config } from '@/lib/config';
import { CareerPilotLogo } from '@/components/layout/careerpilot-logo';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col items-center">
      {/* Logo */}
      <div className="mb-6">
        <CareerPilotLogo
          compact
          markClassName="h-16 w-16 rounded-2xl shadow-md ring-sky-100"
        />
      </div>

      {/* Heading */}
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('welcomeBack')}
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        {t('loginDescription')}
      </p>

      <div className="mt-6 w-full">
        <Suspense fallback={null}>
          <PasswordAuthForm />
        </Suspense>
      </div>

      {(config.auth.emailOtpEnabled || config.auth.googleEnabled) && (
        <>
          <div className="my-6 flex w-full items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-zinc-400">{t('otherMethods')}</span>
            <Separator className="flex-1" />
          </div>

          {config.auth.emailOtpEnabled && (
            <details className="group w-full rounded-xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
              <summary className="cursor-pointer list-none text-center text-sm font-medium text-zinc-600 marker:hidden dark:text-zinc-300">
                {t('useEmailCode')}
              </summary>
              <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <Suspense fallback={null}>
                  <EmailOtpLogin />
                </Suspense>
              </div>
            </details>
          )}

          {config.auth.googleEnabled && (
          <>
            <div className={config.auth.emailOtpEnabled ? 'mt-3 w-full' : 'w-full'}>
              <Suspense fallback={null}>
                <LoginButton />
              </Suspense>
            </div>
          </>
          )}
        </>
      )}

      {/* Terms with clickable links */}
      <p className="mt-6 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        {t.rich('agreeTermsLinks', {
          terms: (chunks) => (
            <Link href="/terms" className="underline hover:no-underline">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className="underline hover:no-underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
