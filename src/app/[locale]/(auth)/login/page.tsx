import { Suspense } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { LoginButton } from '@/components/auth/login-button';
import { EmailOtpLogin } from '@/components/auth/email-otp-login';
import { Separator } from '@/components/ui/separator';
import { config } from '@/lib/config';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col items-center">
      {/* Logo */}
      <div className="mb-6">
        <Image
          src="/logo-icon.svg"
          alt="CareerPilot"
          width={48}
          height={48}
          className="drop-shadow-sm"
        />
      </div>

      {/* Heading */}
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {t('welcomeBack')}
      </h1>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        {t('loginDescription')}
      </p>

      <p className="mt-3 text-center text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {t('registrationNotice')}
      </p>

      <>
          {/* Email OTP login */}
          <div className="mt-6 w-full">
            <Suspense fallback={null}>
              <EmailOtpLogin />
            </Suspense>
          </div>

        {config.auth.googleEnabled && (
          <>
            <div className="my-6 flex w-full items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-zinc-400">{t('or')}</span>
              <Separator className="flex-1" />
            </div>
            <div className="w-full">
              <Suspense fallback={null}>
                <LoginButton />
              </Suspense>
            </div>
          </>
        )}
      </>

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
