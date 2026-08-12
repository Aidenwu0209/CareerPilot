'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { GraduationCap, Loader2, UserRound, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFingerprint } from '@/hooks/use-fingerprint';
import {
  demoIdentityDestination,
  normalizeInternalCallbackUrl,
  persistDemoIdentity,
} from '@/lib/auth/demo-mode';

export function DemoModeLogin() {
  const t = useTranslations('auth.demo');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { fingerprint, isLoading } = useFingerprint();
  const callbackUrl = normalizeInternalCallbackUrl(
    searchParams.get('callbackUrl'),
    `/${locale}/dashboard`,
  );

  const continueAsVisitor = () => {
    if (!fingerprint) return;
    window.location.assign(callbackUrl);
  };

  const enterDemo = (identity: 'student' | 'teacher') => {
    persistDemoIdentity(identity);
    window.location.assign(demoIdentityDestination(locale, identity));
  };

  return (
    <div className="w-full space-y-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100">
        <p className="font-medium">{t('title')}</p>
        <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-300">
          {t('description')}
        </p>
      </div>

      <Button
        onClick={continueAsVisitor}
        disabled={isLoading || !fingerprint}
        className="h-11 w-full cursor-pointer gap-2 rounded-xl"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
        {t('continueVisitor')}
      </Button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => enterDemo('student')}
          className="h-11 cursor-pointer gap-2 rounded-xl"
        >
          <UsersRound className="h-4 w-4" />
          {t('student')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => enterDemo('teacher')}
          className="h-11 cursor-pointer gap-2 rounded-xl"
        >
          <GraduationCap className="h-4 w-4" />
          {t('teacher')}
        </Button>
      </div>
    </div>
  );
}
