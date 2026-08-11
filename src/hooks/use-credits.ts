'use client';

import { useEffect } from 'react';
import { useCreditsStore, type BillingScope } from '@/stores/credits-store';
import { useAuth } from './use-auth';

interface CreditsState {
  balance: number | null;
  accountId: string | null;
  billingScope: BillingScope | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
}

/**
 * Fetches the current user's credit balance from /api/credits/balance.
 *
 * Backed by a shared Zustand store — all components using this hook share
 * the same state. Call `refresh()` after AI operations to sync every
 * consumer (including the navigation balance widget).
 */
export function useCredits(): CreditsState {
  const { balance, accountId, billingScope, loading, error, fetched, refresh } =
    useCreditsStore();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  // Initial fetch — only fires once across all consumers
  useEffect(() => {
    if (!authLoading && isAuthenticated && !fetched && !loading) {
      refresh();
    }
  }, [authLoading, isAuthenticated, fetched, loading, refresh]);

  return { balance, accountId, billingScope, loading, error, refresh };
}
