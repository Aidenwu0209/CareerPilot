'use client';

import { useEffect, useRef, useState } from 'react';

export interface CatalogModelInfo {
  id: string;
  modelIdentifier: string;
  displayName: string;
  providerType: string;
  capabilities: string[];
  tier: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  maxSteps: number | null;
  fixedPrice: number;
  tokenPriceInput: number;
  tokenPriceOutput: number;
}

interface UseModelCatalogResult {
  models: CatalogModelInfo[];
  loading: boolean;
  error: boolean;
}

/**
 * Shared hook that fetches the server-side managed model catalog.
 * Caches the result in a module-level variable so multiple components
 * (chat panel, editor dialogs, etc.) share a single network request.
 */
let cachedModels: CatalogModelInfo[] | null = null;
let inflight: Promise<CatalogModelInfo[]> | null = null;

async function fetchCatalog(): Promise<CatalogModelInfo[]> {
  if (cachedModels) return cachedModels;
  if (inflight) return inflight;

  inflight = fetch('/api/ai/models')
    .then((res) => {
      if (!res.ok) throw new Error('catalog fetch failed');
      return res.json();
    })
    .then((data: { models: CatalogModelInfo[] }) => {
      cachedModels = data.models ?? [];
      return cachedModels;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Allow other modules to bust the cache when model state changes. */
export function invalidateModelCatalog() {
  cachedModels = null;
}

export function useModelCatalog(): UseModelCatalogResult {
  const [models, setModels] = useState<CatalogModelInfo[]>(cachedModels ?? []);
  const [loading, setLoading] = useState(cachedModels === null);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    fetchCatalog()
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setModels(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  return { models, loading, error };
}

/**
 * Compute a human-readable estimated cost string for a model.
 * Returns null when pricing is all zero (free / unconfigured).
 */
export function estimateCredits(model: CatalogModelInfo): string | null {
  if (model.fixedPrice > 0) {
    return `${model.fixedPrice}`;
  }
  if (model.tokenPriceInput > 0 || model.tokenPriceOutput > 0) {
    return '~';
  }
  return null;
}
