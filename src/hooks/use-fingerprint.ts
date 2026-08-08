'use client';

import { useEffect, useState } from 'react';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { useRuntimeConfig } from '@/components/providers/runtime-config-provider';
import {
  buildFingerprintCookie,
  FINGERPRINT_STORAGE_KEY,
} from '@/lib/auth/providers/fingerprint';
import { generateId } from '@/lib/utils';

export function useFingerprint() {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { authEnabled } = useRuntimeConfig();

  useEffect(() => {
    if (authEnabled) {
      setIsLoading(false);
      return;
    }

    function persistFingerprint(fingerprint: string) {
      localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
      document.cookie = buildFingerprintCookie(
        fingerprint,
        window.location.protocol === 'https:',
      );
    }

    async function getFingerprint() {
      try {
        // Check localStorage first
        const stored = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
        if (stored) {
          persistFingerprint(stored);
          setFingerprint(stored);
          setIsLoading(false);
          return;
        }

        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const visitorId = result.visitorId;

        persistFingerprint(visitorId);
        setFingerprint(visitorId);
      } catch {
        // Fallback: generate a random ID
        const fallbackId = generateId();
        persistFingerprint(fallbackId);
        setFingerprint(fallbackId);
      } finally {
        setIsLoading(false);
      }
    }

    getFingerprint();
  }, [authEnabled]);

  return { fingerprint, isLoading };
}
