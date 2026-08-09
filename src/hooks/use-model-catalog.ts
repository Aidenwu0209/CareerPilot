'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './use-auth';
import { readJsonResponse } from '@/lib/http/json-client';

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
 * Caches the result per authenticated user so multiple components share one
 * request without leaking a previous account's plan-scoped model catalog.
 */
let cachedCatalog: { userId: string; models: CatalogModelInfo[] } | null = null;
let inflight: { userId: string; promise: Promise<CatalogModelInfo[]> } | null = null;

async function fetchCatalog(userId: string): Promise<CatalogModelInfo[]> {
  if (cachedCatalog?.userId === userId) return cachedCatalog.models;
  if (inflight?.userId === userId) return inflight.promise;

  const promise = fetch('/api/ai/models')
    .then((response) => readJsonResponse<{ models: CatalogModelInfo[] }>(response))
    .then((data: { models: CatalogModelInfo[] }) => {
      const models = data.models ?? [];
      cachedCatalog = { userId, models };
      return models;
    })
    .finally(() => {
      if (inflight?.userId === userId) inflight = null;
    });

  inflight = { userId, promise };
  return promise;
}

/** Allow other modules to bust the cache when model state changes. */
export function invalidateModelCatalog() {
  cachedCatalog = null;
}

export function useModelCatalog(): UseModelCatalogResult {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const userId = user?.id ?? null;
  const [models, setModels] = useState<CatalogModelInfo[]>([]);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [settledUserId, setSettledUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    if (authLoading) {
      return () => {
        mountedRef.current = false;
      };
    }

    if (!isAuthenticated || !userId) {
      return () => {
        mountedRef.current = false;
      };
    }

    fetchCatalog(userId)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setModels(result);
        setLoadedUserId(userId);
        setSettledUserId(userId);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setSettledUserId(userId);
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [authLoading, isAuthenticated, userId]);

  const catalogBelongsToCurrentUser = loadedUserId === userId;

  return {
    models: catalogBelongsToCurrentUser ? models : [],
    loading: authLoading || (isAuthenticated && (settledUserId !== userId || loading)),
    error: !authLoading && (!isAuthenticated || error),
  };
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
