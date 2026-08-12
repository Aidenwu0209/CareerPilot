'use client';

import { useLocale, useTranslations } from 'next-intl';
import { GraduationCap, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  demoIdentityDestination,
  persistDemoIdentity,
} from '@/lib/auth/demo-mode';

export function DemoModeLogin() {
  const t = useTranslations('auth.demo');
  const locale = useLocale();

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
