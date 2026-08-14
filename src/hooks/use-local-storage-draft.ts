'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useLocalStorageDraft<T>(
  key: string,
  initialValue: T,
  isValid: (value: unknown) => value is T,
  delayMs = 400,
) {
  const [value, setValue] = useState(initialValue);
  const [restored, setRestored] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) {
          setValue(parsed);
          setRestored(true);
        } else {
          localStorage.removeItem(key);
        }
      }
    } catch {
      localStorage.removeItem(key);
    } finally {
      hydrated.current = true;
    }
  }, [isValid, key]);

  useEffect(() => {
    if (!hydrated.current) return;
    const timeout = window.setTimeout(() => localStorage.setItem(key, JSON.stringify(value)), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, key, value]);

  const clear = useCallback(() => {
    localStorage.removeItem(key);
    setRestored(false);
  }, [key]);

  return { value, setValue, restored, clear };
}
