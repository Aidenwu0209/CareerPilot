'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './use-auth';

interface NavContext {
  platformRole: 'super_admin' | 'user';
  isOrgAdmin: boolean;
  orgId: string | null;
  orgName: string | null;
}

/**
 * Fetches the user's role context for navigation rendering.
 * Re-fetches when the authenticated user changes.
 *
 * Note: loading starts as true and flips to false after the first successful
 * or failed fetch. Subsequent refetches (on user change) do not reset to loading.
 */
export function useNavContext() {
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id;
  const [navContext, setNavContext] = useState<NavContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/user/nav-context');
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data && !data.error) {
          setNavContext(data);
        }
      } catch {
        // Network error — keep previous navContext
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  return {
    navContext: isAuthenticated ? navContext : null,
    loading: isAuthenticated ? loading : false,
  };
}
