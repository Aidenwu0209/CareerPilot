'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useRuntimeConfig } from '@/components/providers/runtime-config-provider';
import { useFingerprint } from './use-fingerprint';
import { clearDemoIdentity } from '@/lib/auth/demo-mode';
import { useLocale } from 'next-intl';

export function useAuth() {
  const session = useSession();
  const { fingerprint, isLoading: fpLoading } = useFingerprint();
  const { demoMode } = useRuntimeConfig();
  const locale = useLocale();

  if (session.status === 'authenticated' || !demoMode) {
    return {
      user: session.data?.user
        ? {
            id: session.data.user.id || '',
            name: session.data.user.name,
            email: session.data.user.email,
            avatarUrl: session.data.user.image,
            authType: session.data.user.authType,
            platformRole: (session.data.user.platformRole || 'user') as 'super_admin' | 'user',
            status: (session.data.user.status || 'active') as 'active' | 'suspended',
          }
        : null,
      isLoading: session.status === 'loading',
      isAuthenticated: session.status === 'authenticated',
      signIn: () => signIn('google'),
      signOut: () => signOut(),
    };
  }

  return {
    user: fingerprint
      ? {
          id: `fp_${fingerprint}`,
          name: fingerprint === 'teacher-demo-fingerprint' ? 'Demo Teacher' : 'Demo Student',
          email: null,
          avatarUrl: null,
          authType: 'fingerprint' as const,
        }
      : null,
    isLoading: fpLoading,
    isAuthenticated: !!fingerprint,
    signIn: () => {},
    signOut: () => {
      clearDemoIdentity();
      window.location.assign(`/${locale}/demo`);
    },
  };
}
