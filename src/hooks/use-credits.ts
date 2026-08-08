'use client';

import { useCallback, useEffect, useState } from 'react';

interface CreditsState {
  balance: number | null;
  accountId: string | null;
  billingScope: { type: 'personal' | 'organization'; id?: string } | null;
  loading: boolean;
  error: boolean;
}

/**
 * Fetches the current user's credit balance from /api/credits/balance.
 * Call refresh() after AI operations to keep the displayed balance in sync.
 */
export function useCredits() {
  const [state, setState] = useState<CreditsState>({
    balance: null,
    accountId: null,
    billingScope: null,
    loading: true,
    error: false,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/balance');
      if (!res.ok) throw new Error('balance fetch failed');
      const data = await res.json();
      setState({
        balance: data.balance,
        accountId: data.accountId,
        billingScope: data.billingScope,
        loading: false,
        error: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
