'use client';

import { useEffect, useState } from 'react';
import { useRuntimeConfig } from '@/components/providers/runtime-config-provider';
import {
  FINGERPRINT_STORAGE_KEY,
} from '@/lib/auth/providers/fingerprint';
import { isDemoFingerprint } from '@/lib/auth/demo-mode';

export function useFingerprint() {
  const [demoIdentity, setDemoIdentity] = useState<{
    fingerprint: string | null;
    isLoading: boolean;
  }>({ fingerprint: null, isLoading: true });
  const { demoMode } = useRuntimeConfig();

  useEffect(() => {
    if (!demoMode) {
      return;
    }

    const timer = window.setTimeout(() => {
      const stored = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
      setDemoIdentity({
        fingerprint: isDemoFingerprint(stored) ? stored : null,
        isLoading: false,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [demoMode]);

  return demoMode ? demoIdentity : { fingerprint: null, isLoading: false };
}
