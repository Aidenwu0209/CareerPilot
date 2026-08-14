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
  expiresAt?: number;
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
  private operations = 0;

  constructor(
    private readonly store: Map<string, RateLimitEntry> = new Map(),
    private readonly sweepInterval = 256,
  ) {}

  private sweepExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (entry.expiresAt != null && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    this.operations += 1;
    if (this.operations % this.sweepInterval === 0) {
      this.sweepExpired(now);
    }
    const existing = this.store.get(key);

    if (!existing || (existing.expiresAt ?? existing.windowStart + windowMs) <= now) {
      const entry: RateLimitEntry = { count: 1, windowStart: now, expiresAt: now + windowMs };
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

// ─── Redis Adapter ───────────────────────────────────────────────────────────

/**
 * Redis-backed fixed-window limiter for multi-instance production deployments.
 * The Lua script makes increment + expiry assignment atomic.
 */
export class RedisRateLimitAdapter implements RateLimitAdapter {
  private clientPromise: Promise<import('redis').RedisClientType> | null = null;

  constructor(
    private readonly url: string,
    private readonly keyPrefix = 'careerpilot:rate-limit:',
  ) {}

  private getClient(): Promise<import('redis').RedisClientType> {
    if (!this.clientPromise) {
      this.clientPromise = import('redis').then(async ({ createClient }) => {
        const client = createClient({ url: this.url });
        client.on('error', () => {
          // Availability is reported through isAvailable/checkRateLimit.
        });
        await client.connect();
        return client as import('redis').RedisClientType;
      });
    }
    return this.clientPromise;
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const client = await this.getClient();
    const result = await client.eval(
      [
        "local count = redis.call('INCR', KEYS[1])",
        "local ttl = redis.call('PTTL', KEYS[1])",
        "if count == 1 or ttl < 0 then",
        "  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
        "  ttl = tonumber(ARGV[1])",
        'end',
        'return {count, ttl}',
      ].join('\n'),
      { keys: [this.redisKey(key)], arguments: [String(windowMs)] },
    );
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Unexpected Redis rate-limit response');
    }
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    const now = Date.now();
    return {
      count,
      windowStart: ttl >= 0 ? now - Math.max(0, windowMs - ttl) : now,
      expiresAt: ttl >= 0 ? now + ttl : now + windowMs,
    };
  }

  async reset(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(this.redisKey(key));
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    for await (const result of client.scanIterator({ MATCH: `${this.keyPrefix}*`, COUNT: 100 })) {
      const keys = Array.isArray(result) ? result : [result];
      if (keys.length > 0) await client.del(keys);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const client = await this.getClient();
      return client.isReady;
    } catch {
      return false;
    }
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
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
      adapterInstance = new RedisRateLimitAdapter(redisUrl);
    } else if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_DISTRIBUTED_REQUIRED === 'true') {
      adapterInstance = new UnavailableRateLimitAdapter();
    } else {
      adapterInstance = new MemoryRateLimitAdapter(sharedStore);
    }
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
  careerApi: {
    limit: 120,
    windowMs: 60 * 1000,
    failClosed: true,
  },
  interviewApi: {
    limit: 60,
    windowMs: 60 * 1000,
    failClosed: true,
  },
  reportExport: {
    limit: 5,
    windowMs: 60 * 1000,
    failClosed: true,
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
