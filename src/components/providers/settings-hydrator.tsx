'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useSettingsStore } from '@/stores/settings-store';

/** Load private settings only after the session or dev fingerprint is ready. */
export function SettingsHydrator() {
  const { isLoading, isAuthenticated } = useAuth();
  const hydrate = useSettingsStore((state) => state.hydrate);
  const hydrated = useSettingsStore((state) => state._hydrated);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !hydrated) {
      void hydrate();
    }
  }, [hydrate, hydrated, isAuthenticated, isLoading]);

  return null;
}
