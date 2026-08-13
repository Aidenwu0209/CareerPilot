/**
 * Cross-instance distributed rate limiting module.
 *
 * Design:
 * - RateLimitAdapter interface with pluggable backends (memory, Redis, DB, etc.)
 * - MemoryRateLimitAdapter uses a shared Map for single-instance / test usage
 * - Factory function returns a singleton adapter; in production, a Redis or DB
 *   adapter would be configured here to achieve true cross-instance sharing
 * - checkRateLimit() is the public API used by route handlers
 * - When the adapter is unavailable, high-cost AI capabilities fail-closed
 *   per policy configuration (AC5)
 *
 * Rate limit keys combine scope + dimension for multi-dimensional limiting:
 *   `otp:ip:1.2.3.4`, `otp:email:user@example.com`, `ai-chat:user:<userId>`
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitAdapter {
  /** Atomically increment the counter for `key`, creating/resetting the window if expired. */
  increment(key: string, windowMs: number): Promise<RateLimitEntry>;
  /** Reset a single key (delete the bucket). */
  reset(key: string): Promise<void>;
  /** Clear all entries. */
  clear(): Promise<void>;
  /** Check if the backing store is reachable / functional. */
  isAvailable(): Promise<boolean>;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets. Always >= 1 when denied. */
  retryAfter: number;
}

export interface RateLimitPolicy {
  /** Maximum requests allowed within the window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /**
   * When the rate-limit store is unavailable:
   * - true  → deny the request (high-cost AI capabilities)
   * - false → allow the request (low-cost / read-only)
   */
  failClosed: boolean;
}

// ─── Memory Adapter ──────────────────────────────────────────────────────────

/**
 * In-memory rate limit adapter backed by a Map.
 *
 * Multiple adapter instances sharing the same Map see the same state —
 * this simulates cross-instance sharing in tests (AC2).
 *
 * In production, a Redis or database adapter would be used instead.
 */
export class MemoryRateLimitAdapter implements RateLimitAdapter {
  constructor(private readonly store: Map<string, RateLimitEntry> = new Map()) {}

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now - existing.windowStart > windowMs) {
      const entry: RateLimitEntry = { count: 1, windowStart: now };
      this.store.set(key, entry);
      return entry;
    }

    existing.count++;
    this.store.set(key, existing);
    return existing;
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/**
 * Adapter that always reports unavailable (for testing fail-closed / fail-open).
 */
export class UnavailableRateLimitAdapter implements RateLimitAdapter {
  async increment(): Promise<RateLimitEntry> {
    throw new Error('Rate limit store unavailable');
  }
  async reset(): Promise<void> {
    throw new Error('Rate limit store unavailable');
  }
  async clear(): Promise<void> {}
  async isAvailable(): Promise<boolean> {
    return false;
  }
}

// ─── Adapter Factory ─────────────────────────────────────────────────────────

/**
 * Module-level shared store. All MemoryRateLimitAdapter instances created
 * through getRateLimitAdapter() share this store, enabling cross-instance
 * counting within a single Node.js process.
 *
 * For true cross-process sharing, set a custom adapter via setRateLimitAdapter().
 */
const sharedStore = new Map<string, RateLimitEntry>();

let adapterInstance: RateLimitAdapter | null = null;

/**
 * Get the singleton rate limit adapter.
 *
 * Default: MemoryRateLimitAdapter backed by the shared module-level Map.
 * Override: call setRateLimitAdapter() to inject a Redis/DB adapter.
 */
export function getRateLimitAdapter(): RateLimitAdapter {
  if (!adapterInstance) {
    adapterInstance = new MemoryRateLimitAdapter(sharedStore);
  }
  return adapterInstance;
}

/**
 * Override the adapter (useful for production Redis/DB wiring or tests).
 */
export function setRateLimitAdapter(adapter: RateLimitAdapter | null): void {
  adapterInstance = adapter;
}

/**
 * Reset to default adapter. Clears any custom adapter.
 */
export function resetRateLimitAdapter(): void {
  adapterInstance = null;
  sharedStore.clear();
}

// ─── Core Check Function ─────────────────────────────────────────────────────

/**
 * Check rate limit for a given key and policy.
 *
 * @param key      - Unique key combining scope + dimension (e.g. `ai-chat:user:abc123`)
 * @param policy   - Rate limit policy with limit, window, and fail-closed config
 * @returns        - { allowed, retryAfter } where retryAfter is in seconds
 */
export async function checkRateLimit(
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  try {
    const adapter = getRateLimitAdapter();
    const available = await adapter.isAvailable();

    // AC5: store unavailable → fail-closed for high-cost, fail-open for low-cost
    if (!available) {
      if (policy.failClosed) {
        return { allowed: false, retryAfter: Math.ceil(policy.windowMs / 1000) };
      }
      return { allowed: true, retryAfter: 0 };
    }

    const entry = await adapter.increment(key, policy.windowMs);

    if (entry.count > policy.limit) {
      const resetAt = entry.windowStart + policy.windowMs;
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    return { allowed: true, retryAfter: 0 };
  } catch {
    // AC5: adapter error → same fail-closed / fail-open logic
    if (policy.failClosed) {
      return { allowed: false, retryAfter: Math.ceil(policy.windowMs / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }
}

// ─── Response Helpers ────────────────────────────────────────────────────────

/**
 * Create a 429 RATE_LIMITED response with Retry-After header.
 *
 * Framework-agnostic (returns plain Response) so it can be used in any
 * route handler without importing Next.js utilities.
 */
export function rateLimitedResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: 'RATE_LIMITED' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, Math.floor(retryAfter))),
      },
    },
  );
}

// ─── IP Extraction ───────────────────────────────────────────────────────────

/**
 * Extract the client IP address from request headers.
 *
 * Checks x-forwarded-for (first entry), then x-real-ip, falling back to 'unknown'.
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Clear all rate limit data.
 *
 * Async for adapter compatibility — MemoryRateLimitAdapter resolves immediately.
 */
export async function clearRateLimits(): Promise<void> {
  await getRateLimitAdapter().clear();
}

/**
 * Create a fresh MemoryRateLimitAdapter with its own isolated store.
 * Useful for tests that need a clean slate or want to simulate a second instance.
 */
export function createIsolatedAdapter(): MemoryRateLimitAdapter {
  return new MemoryRateLimitAdapter(new Map());
}

// ─── Rate Limit Policies ─────────────────────────────────────────────────────

/**
 * Rate limit policies for each high-cost route.
 *
 * Keys and thresholds are configured per route, with appropriate dimensions:
 * - OTP: IP (5/hr) and email (3/hr) — prevents enumeration and spam
 * - AI Chat: per-user (30/min) — high-cost streaming, fail-closed
 * - AI Models: per-user (20/min) — read-only catalog, fail-open
 * - LinkedIn Photo: per-user (5/min) — high-cost image gen, fail-closed
 * - Resume Parse: per-user (10/min) — high-cost PDF processing, fail-closed
 */
export const RATE_LIMIT_POLICIES = {
  otpRequestIP: {
    limit: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    failClosed: false, // OTP has its own DB-level abuse protection
  },
  otpRequestEmail: {
    limit: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    failClosed: false,
  },
  passwordLoginIP: {
    limit: 20,
    windowMs: 15 * 60 * 1000,
    failClosed: true,
  },
  passwordLoginEmail: {
    limit: 5,
    windowMs: 15 * 60 * 1000,
    failClosed: true,
  },
  passwordRegisterIP: {
    limit: 10,
    windowMs: 60 * 60 * 1000,
    failClosed: true,
  },
  passwordRegisterEmail: {
    limit: 3,
    windowMs: 60 * 60 * 1000,
    failClosed: true,
  },
  aiChat: {
    limit: 30,
    windowMs: 60 * 1000, // 1 minute
    failClosed: true, // high-cost AI — deny when store down
  },
  aiModels: {
    limit: 20,
    windowMs: 60 * 1000,
    failClosed: false, // read-only catalog — allow when store down
  },
  linkedinPhoto: {
    limit: 5,
    windowMs: 60 * 1000,
    failClosed: true, // high-cost image generation
  },
  resumeParse: {
    limit: 10,
    windowMs: 60 * 1000,
    failClosed: true, // high-cost PDF processing
  },
  sharePassword: {
    limit: 10,
    windowMs: 15 * 60 * 1000,
    failClosed: true, // public password verification must resist brute force
  },
} as const;

/**
 * Build a rate limit key from scope and identifier.
 *
 * Convention: `<scope>:<dimension>:<value>` (e.g. `ai-chat:user:abc123`)
 */
export function rateLimitKey(scope: string, dimension: string, value: string): string {
  return `${scope}:${dimension}:${value}`;
}
