import { create } from 'zustand';

export interface BillingScope {
  type: 'personal' | 'organization';
  id?: string;
  orgName?: string | null;
}

interface CreditsStore {
  balance: number | null;
  accountId: string | null;
  billingScope: BillingScope | null;
  loading: boolean;
  error: boolean;
  fetched: boolean;
  refresh: () => Promise<void>;
}

/**
 * Shared credits store so all components using `useCredits()` stay in sync.
 * When any component calls `refresh()` after an AI operation, every consumer
 * (including the navigation balance widget) re-renders with the updated value.
 */
export const useCreditsStore = create<CreditsStore>((set, get) => ({
  balance: null,
  accountId: null,
  billingScope: null,
  loading: false,
  error: false,
  fetched: false,

  refresh: async () => {
    // Prevent concurrent duplicate fetches
    if (get().loading) return;
    set({ loading: true, error: false });
    try {
      const res = await fetch('/api/credits/balance');
      if (!res.ok) throw new Error('balance fetch failed');
      const data = await res.json();
      set({
        balance: data.balance,
        accountId: data.accountId,
        billingScope: data.billingScope,
        loading: false,
        error: false,
        fetched: true,
      });
    } catch {
      set((prev) => ({ ...prev, loading: false, error: true, fetched: true }));
    }
  },
}));
