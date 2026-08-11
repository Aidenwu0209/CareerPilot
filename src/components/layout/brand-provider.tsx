'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_BRANDING, type OrganizationBranding } from '@/lib/branding';

export type Brand = 'mint' | 'blue' | 'pink';

const STORAGE_KEY = 'careerpilot-brand';
const LEGACY_STORAGE_KEY = 'jadeai-brand';
const VALID_BRANDS: Brand[] = ['mint', 'blue', 'pink'];

// Migrate legacy values (pre-rename) to current ids.
function normalizeBrand(raw: string | null): Brand | null {
  if (raw === 'boss') return 'mint';
  if (raw === 'jade') return 'blue';
  if (raw && (VALID_BRANDS as string[]).includes(raw)) return raw as Brand;
  return null;
}

function readStoredBrand(): string | null {
  if (typeof window === 'undefined') return null;
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return legacy;
  }
  return null;
}

interface BrandContextValue {
  brand: Brand;
  setBrand: (brand: Brand) => void;
  branding: OrganizationBranding;
  managedBranding: boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

function applyBrand(brand: Brand) {
  if (typeof document === 'undefined') return;
  if (brand === 'mint') {
    document.documentElement.removeAttribute('data-brand');
  } else {
    document.documentElement.setAttribute('data-brand', brand);
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<Brand>('mint');
  const [branding, setBranding] = useState<OrganizationBranding>(DEFAULT_BRANDING);
  const [managedBranding, setManagedBranding] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const normalized = normalizeBrand(readStoredBrand());
    if (normalized) {
      // Persist migration so legacy 'boss' is rewritten to 'mint'.
      localStorage.setItem(STORAGE_KEY, normalized);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical SSR hydration from localStorage
      setBrandState(normalized);
      applyBrand(normalized);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/branding')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active || !data?.branding) return;
        const next = data.branding as OrganizationBranding;
        setBranding(next);
        const managed = Boolean(next.logoUrl || next.primaryColor || next.productName !== DEFAULT_BRANDING.productName || next.tagline);
        setManagedBranding(managed);
        applyOrganizationBranding(next);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const setBrand = (next: Brand) => {
    setBrandState(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
    }
    applyBrand(next);
  };

  return <BrandContext.Provider value={{ brand, setBrand, branding, managedBranding }}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error('useBrand must be used within BrandProvider');
  return ctx;
}

function applyOrganizationBranding(branding: OrganizationBranding) {
  if (typeof document === 'undefined' || !branding.primaryColor) return;
  const root = document.documentElement;
  root.style.setProperty('--brand', branding.primaryColor);
  root.style.setProperty('--brand-hover', `color-mix(in srgb, ${branding.primaryColor} 82%, black)`);
  root.style.setProperty('--brand-muted', `color-mix(in srgb, ${branding.primaryColor} 12%, white)`);
  root.style.setProperty('--brand-ring', `color-mix(in srgb, ${branding.primaryColor} 40%, transparent)`);
}
