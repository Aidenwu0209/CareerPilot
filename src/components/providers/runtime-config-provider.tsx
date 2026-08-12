'use client';

import { createContext, useContext } from 'react';

interface RuntimeConfig {
  mode: 'product' | 'demo';
  demoMode: boolean;
  googleEnabled: boolean;
}

const RuntimeConfigContext = createContext<RuntimeConfig>({
  mode: 'product',
  demoMode: false,
  googleEnabled: false,
});

export function RuntimeConfigProvider({
  children,
  mode,
  googleEnabled,
}: {
  children: React.ReactNode;
  mode: 'product' | 'demo';
  googleEnabled: boolean;
}) {
  return (
    <RuntimeConfigContext.Provider
      value={{ mode, demoMode: mode === 'demo', googleEnabled }}
    >
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}
