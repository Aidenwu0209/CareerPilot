import { create } from 'zustand';

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

interface SettingsStore {
  // AI settings (managed server-side, no longer user-configurable via BYOK)
  aiProvider: AIProvider;
  aiApiKey: string; // always empty — legacy field kept for type compat
  aiBaseURL: string;
  aiModel: string;
  // Editor settings
  autoSave: boolean;
  autoSaveInterval: number; // in milliseconds

  // Hydration state
  _hydrated: boolean;
  _syncing: boolean;

  // Actions
  setAIProvider: (provider: AIProvider) => void;
  setAIApiKey: (key: string) => void;
  setAIBaseURL: (url: string) => void;
  setAIModel: (model: string) => void;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
  hydrate: () => void;
}

// Legacy localStorage keys that must be cleaned up (US-060)
const LEGACY_STORAGE_KEYS = [
  'jade_api_key',
  'jade_provider_configs',
  'jade_nanobanana_api_key',
];

/**
 * Remove legacy BYOK localStorage entries.
 * Called once on hydration. Does NOT copy values anywhere.
 */
function cleanupLegacyStorage() {
  if (typeof window === 'undefined') return;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

function getHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

// Sync settings to server (debounced)
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function syncToServer(state: SettingsStore) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      await fetch('/api/user/settings', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          aiProvider: state.aiProvider,
          aiBaseURL: state.aiBaseURL,
          aiModel: state.aiModel,
          autoSave: state.autoSave,
          autoSaveInterval: state.autoSaveInterval,
        }),
      });
    } catch {
      // silently fail, local state is still correct
    }
  }, 500);
}

/**
 * Returns empty headers — BYOK headers are no longer generated.
 * Kept as a no-op export so existing callers don't break.
 * The managed AI gateway resolves provider/model server-side.
 */
export function getAIHeaders(): Record<string, string> {
  return {};
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  aiProvider: 'openai',
  aiApiKey: '',
  aiBaseURL: '',
  aiModel: '',
  autoSave: true,
  autoSaveInterval: 500,
  _hydrated: false,
  _syncing: false,

  setAIProvider: (provider) => {
    set({ aiProvider: provider });
    syncToServer(useSettingsStore.getState());
  },

  setAIApiKey: (key) => {
    set({ aiApiKey: key });
  },

  setAIBaseURL: (url) => {
    set({ aiBaseURL: url });
    syncToServer(useSettingsStore.getState());
  },

  setAIModel: (model) => {
    set({ aiModel: model });
    syncToServer(useSettingsStore.getState());
  },

  setAutoSave: (enabled) => {
    set({ autoSave: enabled });
    syncToServer(useSettingsStore.getState());
  },

  setAutoSaveInterval: (interval) => {
    set({ autoSaveInterval: interval });
    syncToServer(useSettingsStore.getState());
  },

  hydrate: async () => {
    if (useSettingsStore.getState()._hydrated) return;

    // Clean up legacy BYOK localStorage keys (US-060)
    cleanupLegacyStorage();

    // Load settings from server
    try {
      const res = await fetch('/api/user/settings', { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const provider = (data.aiProvider === 'custom' || data.aiProvider === 'azure') ? 'openai' : data.aiProvider;
        set({
          ...(provider && { aiProvider: provider }),
          ...(data.aiBaseURL && { aiBaseURL: data.aiBaseURL }),
          ...(data.aiModel && { aiModel: data.aiModel }),
          ...(typeof data.autoSave === 'boolean' && { autoSave: data.autoSave }),
          ...(typeof data.autoSaveInterval === 'number' && { autoSaveInterval: data.autoSaveInterval }),
          _hydrated: true,
        });
        return;
      }
    } catch { /* fall through */ }

    set({ _hydrated: true });
  },
}));
