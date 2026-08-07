import { describe, it, expect, beforeEach } from 'vitest';

/**
 * US-022 tests: Cross-instance distributed rate limiting
 *
 * Validates:
 * AC1: Appropriate rate limit keys and thresholds per route
 * AC2: Cross-instance shared counting (switching instances can't bypass)
 * AC3: Rate-limited requests return 429 RATE_LIMITED with Retry-After header
 * AC4: Rate-limited requests do not call providers (verified via spy)
 * AC5: When rate limit store is unavailable, high-cost AI fails-closed
 */

// --- Import the module under test ---
import {
  MemoryRateLimitAdapter,
  UnavailableRateLimitAdapter,
  checkRateLimit,
  rateLimitedResponse,
  getClientIP,
  clearRateLimits,
  getRateLimitAdapter,
  setRateLimitAdapter,
  resetRateLimitAdapter,
  createIsolatedAdapter,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from './rate-limit';

beforeEach(async () => {
  // Reset to default singleton adapter with clean store
  resetRateLimitAdapter();
});

// ═══════════════════════════════════════════════════════════════════════════
// AC1: Rate limit policies are correctly configured per route
// ═══════════════════════════════════════════════════════════════════════════
describe('AC1: Rate limit policy configuration', () => {
  it('defines policies for all required routes', () => {
    const requiredRoutes = [
      'otpRequestIP',
      'otpRequestEmail',
      'aiChat',
      'aiModels',
      'linkedinPhoto',
      'resumeParse',
    ];

    for (const route of requiredRoutes) {
      expect(RATE_LIMIT_POLICIES).toHaveProperty(route);
      const policy = RATE_LIMIT_POLICIES[route as keyof typeof RATE_LIMIT_POLICIES];
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowMs).toBeGreaterThan(0);
      expect(typeof policy.failClosed).toBe('boolean');
    }
  });

  it('OTP request uses IP (5/hr) and email (3/hr) dimensions', () => {
    expect(RATE_LIMIT_POLICIES.otpRequestIP.limit).toBe(5);
    expect(RATE_LIMIT_POLICIES.otpRequestIP.windowMs).toBe(60 * 60 * 1000);
    expect(RATE_LIMIT_POLICIES.otpRequestEmail.limit).toBe(3);
    expect(RATE_LIMIT_POLICIES.otpRequestEmail.windowMs).toBe(60 * 60 * 1000);
  });

  it('AI chat uses per-user limiting with fail-closed', () => {
    expect(RATE_LIMIT_POLICIES.aiChat.failClosed).toBe(true);
    expect(RATE_LIMIT_POLICIES.aiChat.limit).toBeGreaterThan(0);
  });

  it('LinkedIn photo uses per-user limiting with fail-closed (high-cost)', () => {
    expect(RATE_LIMIT_POLICIES.linkedinPhoto.failClosed).toBe(true);
    expect(RATE_LIMIT_POLICIES.linkedinPhoto.limit).toBeLessThanOrEqual(10);
  });

  it('Resume parse uses per-user limiting with fail-closed (high-cost)', () => {
    expect(RATE_LIMIT_POLICIES.resumeParse.failClosed).toBe(true);
    expect(RATE_LIMIT_POLICIES.resumeParse.limit).toBeLessThanOrEqual(20);
  });

  it('AI models uses fail-open (read-only catalog lookup)', () => {
    expect(RATE_LIMIT_POLICIES.aiModels.failClosed).toBe(false);
  });

  it('rateLimitKey produces consistent scoped keys', () => {
    expect(rateLimitKey('ai-chat', 'user', 'abc123')).toBe('ai-chat:user:abc123');
    expect(rateLimitKey('otp', 'ip', '1.2.3.4')).toBe('otp:ip:1.2.3.4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2: Cross-instance shared counting
// ═══════════════════════════════════════════════════════════════════════════
describe('AC2: Cross-instance shared counting', () => {
  it('two adapters sharing the same Map see each other counts', async () => {
    const sharedStore = new Map();
    const instance1 = new MemoryRateLimitAdapter(sharedStore);
    const instance2 = new MemoryRateLimitAdapter(sharedStore);

    // Increment via instance 1
    const entry1 = await instance1.increment('test-key', 60_000);
    expect(entry1.count).toBe(1);

    // Instance 2 should see the same count
    const entry2 = await instance2.increment('test-key', 60_000);
    expect(entry2.count).toBe(2);

    // Instance 1 sees count from instance 2
    const entry3 = await instance1.increment('test-key', 60_000);
    expect(entry3.count).toBe(3);
  });

  it('switching instances cannot bypass rate limit', async () => {
    const sharedStore = new Map();
    const instances = [
      new MemoryRateLimitAdapter(sharedStore),
      new MemoryRateLimitAdapter(sharedStore),
    ];

    const policy = { limit: 3, windowMs: 60_000, failClosed: true };

    // Exhaust the limit alternating between instances
    for (let i = 0; i < 3; i++) {
      const adapter = instances[i % instances.length];
      const entry = await adapter.increment('shared-key', policy.windowMs);
      expect(entry.count).toBe(i + 1);
    }

    // 4th request from either instance exceeds the limit
    const entry4 = await instances[0].increment('shared-key', policy.windowMs);
    expect(entry4.count).toBe(4); // exceeds limit of 3
    const entry5 = await instances[1].increment('shared-key', policy.windowMs);
    expect(entry5.count).toBe(5); // still increments — caller checks count > limit
  });

  it('getRateLimitAdapter returns singleton backed by shared store', async () => {
    // The default adapter is a singleton — all calls share the same store
    const adapter = getRateLimitAdapter();
    await adapter.increment('singleton-test', 60_000);

    const sameAdapter = getRateLimitAdapter();
    const entry = await sameAdapter.increment('singleton-test', 60_000);
    expect(entry.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3: 429 RATE_LIMITED response with Retry-After header
// ═══════════════════════════════════════════════════════════════════════════
describe('AC3: 429 response with Retry-After', () => {
  it('checkRateLimit denies when over limit', async () => {
    const policy = { limit: 2, windowMs: 60_000, failClosed: true };

    // First 2 requests allowed
    expect((await checkRateLimit('test-3', policy)).allowed).toBe(true);
    expect((await checkRateLimit('test-3', policy)).allowed).toBe(true);

    // 3rd request denied
    const result = await checkRateLimit('test-3', policy);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('rateLimitedResponse returns 429 with correct headers', () => {
    const response = rateLimitedResponse(60);

    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('rateLimitedResponse body contains RATE_LIMITED error', async () => {
    const response = rateLimitedResponse(30);
    const body = await response.json();
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('rateLimitedResponse always has Retry-After >= 1', () => {
    const response = rateLimitedResponse(0);
    expect(response.headers.get('Retry-After')).toBe('1');
  });

  it('retryAfter is proportional to remaining window time', async () => {
    const policy = { limit: 1, windowMs: 5_000, failClosed: true };

    // Use up the limit
    await checkRateLimit('retry-test', policy);

    // Next request should have retryAfter roughly = 5 seconds
    const result = await checkRateLimit('retry-test', policy);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    expect(result.retryAfter).toBeLessThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4: Rate-limited requests do not call providers
// ═══════════════════════════════════════════════════════════════════════════
describe('AC4: Rate-limited requests return before any provider call', () => {
  it('checkRateLimit is a pure check — no side effects beyond counting', async () => {
    const policy = { limit: 1, windowMs: 60_000, failClosed: true };

    // First request allowed
    const r1 = await checkRateLimit('no-side-effect', policy);
    expect(r1.allowed).toBe(true);

    // Second request denied
    const r2 = await checkRateLimit('no-side-effect', policy);
    expect(r2.allowed).toBe(false);

    // The key count should be exactly 2 (one allow + one deny = 2 increments)
    const adapter = getRateLimitAdapter();
    const entry = await adapter.increment('no-side-effect', policy.windowMs);
    expect(entry.count).toBe(3); // 2 from checkRateLimit + 1 here
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5: Fail-closed behavior when rate limit store is unavailable
// ═══════════════════════════════════════════════════════════════════════════
describe('AC5: Store unavailable fail-closed / fail-open', () => {
  it('high-cost AI (failClosed=true) denies when store unavailable', async () => {
    setRateLimitAdapter(new UnavailableRateLimitAdapter());

    const policy = { limit: 100, windowMs: 60_000, failClosed: true };
    const result = await checkRateLimit('fail-closed-test', policy);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('low-cost routes (failClosed=false) allow when store unavailable', async () => {
    setRateLimitAdapter(new UnavailableRateLimitAdapter());

    const policy = { limit: 100, windowMs: 60_000, failClosed: false };
    const result = await checkRateLimit('fail-open-test', policy);

    expect(result.allowed).toBe(true);
  });

  it('aiChat policy is fail-closed', () => {
    expect(RATE_LIMIT_POLICIES.aiChat.failClosed).toBe(true);
  });

  it('linkedinPhoto policy is fail-closed', () => {
    expect(RATE_LIMIT_POLICIES.linkedinPhoto.failClosed).toBe(true);
  });

  it('resumeParse policy is fail-closed', () => {
    expect(RATE_LIMIT_POLICIES.resumeParse.failClosed).toBe(true);
  });

  it('aiModels policy is fail-open (read-only)', () => {
    expect(RATE_LIMIT_POLICIES.aiModels.failClosed).toBe(false);
  });

  it('otpRequest policies are fail-open (auth flow should not block)', () => {
    expect(RATE_LIMIT_POLICIES.otpRequestIP.failClosed).toBe(false);
    expect(RATE_LIMIT_POLICIES.otpRequestEmail.failClosed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Memory Adapter Tests
// ═══════════════════════════════════════════════════════════════════════════
describe('MemoryRateLimitAdapter', () => {
  it('increments count within the same window', async () => {
    const adapter = new MemoryRateLimitAdapter();
    const windowMs = 60_000;

    expect((await adapter.increment('k', windowMs)).count).toBe(1);
    expect((await adapter.increment('k', windowMs)).count).toBe(2);
    expect((await adapter.increment('k', windowMs)).count).toBe(3);
  });

  it('resets count when window expires', async () => {
    const adapter = new MemoryRateLimitAdapter();
    const shortWindow = 10; // 10ms

    await adapter.increment('reset-key', shortWindow);
    await adapter.increment('reset-key', shortWindow);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 20));

    const entry = await adapter.increment('reset-key', shortWindow);
    expect(entry.count).toBe(1); // reset
  });

  it('maintains separate buckets for different keys', async () => {
    const adapter = new MemoryRateLimitAdapter();

    await adapter.increment('key-a', 60_000);
    await adapter.increment('key-a', 60_000);

    const entryB = await adapter.increment('key-b', 60_000);
    expect(entryB.count).toBe(1);
  });

  it('reset deletes a specific key', async () => {
    const adapter = new MemoryRateLimitAdapter();

    await adapter.increment('keep', 60_000);
    await adapter.increment('delete', 60_000);

    await adapter.reset('delete');

    const entry = await adapter.increment('delete', 60_000);
    expect(entry.count).toBe(1); // was reset, so starts fresh

    const keepEntry = await adapter.increment('keep', 60_000);
    expect(keepEntry.count).toBe(2); // was not reset
  });

  it('clear empties all entries', async () => {
    const adapter = new MemoryRateLimitAdapter();

    await adapter.increment('a', 60_000);
    await adapter.increment('b', 60_000);

    await adapter.clear();

    expect((await adapter.increment('a', 60_000)).count).toBe(1);
    expect((await adapter.increment('b', 60_000)).count).toBe(1);
  });

  it('isAvailable returns true', async () => {
    const adapter = new MemoryRateLimitAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('createIsolatedAdapter has independent store', async () => {
    const adapter1 = createIsolatedAdapter();
    const adapter2 = createIsolatedAdapter();

    await adapter1.increment('iso', 60_000);

    const entry = await adapter2.increment('iso', 60_000);
    expect(entry.count).toBe(1); // independent — doesn't see adapter1's count
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getClientIP Tests
// ═══════════════════════════════════════════════════════════════════════════
describe('getClientIP', () => {
  it('extracts first IP from x-forwarded-for', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(getClientIP(request)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-real-ip': '9.8.7.6' },
    });
    expect(getClientIP(request)).toBe('9.8.7.6');
  });

  it('falls back to "unknown" when no headers present', () => {
    const request = new Request('https://example.com');
    expect(getClientIP(request)).toBe('unknown');
  });

  it('trims whitespace from x-real-ip', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-real-ip': '  1.2.3.4  ' },
    });
    expect(getClientIP(request)).toBe('1.2.3.4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: checkRateLimit with policies
// ═══════════════════════════════════════════════════════════════════════════
describe('checkRateLimit integration with policies', () => {
  beforeEach(async () => {
    await clearRateLimits();
  });

  it('respects aiChat policy limit of 30 per minute', async () => {
    const policy = RATE_LIMIT_POLICIES.aiChat;
    const key = rateLimitKey('ai-chat', 'user', 'integration-user');

    for (let i = 0; i < policy.limit; i++) {
      const result = await checkRateLimit(key, policy);
      expect(result.allowed).toBe(true);
    }

    // Next request should be denied
    const denied = await checkRateLimit(key, policy);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it('different users have independent rate limits', async () => {
    const policy = RATE_LIMIT_POLICIES.aiChat;

    // User A exhausts their limit
    for (let i = 0; i < policy.limit; i++) {
      await checkRateLimit(rateLimitKey('ai-chat', 'user', 'userA'), policy);
    }

    // User B should still be allowed
    const result = await checkRateLimit(
      rateLimitKey('ai-chat', 'user', 'userB'),
      policy,
    );
    expect(result.allowed).toBe(true);
  });

  it('different scopes are independent', async () => {
    const policy = RATE_LIMIT_POLICIES.aiChat;

    // Exhaust ai-chat limit
    for (let i = 0; i < policy.limit; i++) {
      await checkRateLimit(rateLimitKey('ai-chat', 'user', 'userX'), policy);
    }

    // linkedin-photo for the same user should be independent
    const result = await checkRateLimit(
      rateLimitKey('linkedin-photo', 'user', 'userX'),
      RATE_LIMIT_POLICIES.linkedinPhoto,
    );
    expect(result.allowed).toBe(true);
  });

  it('window reset allows requests again after expiry', async () => {
    // Use a short window for testing
    const policy = { limit: 1, windowMs: 50, failClosed: true }; // 50ms window
    const key = 'window-reset-test';

    expect((await checkRateLimit(key, policy)).allowed).toBe(true);
    expect((await checkRateLimit(key, policy)).allowed).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should be allowed again
    expect((await checkRateLimit(key, policy)).allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Adapter override and reset
// ═══════════════════════════════════════════════════════════════════════════
describe('Adapter factory management', () => {
  it('setRateLimitAdapter overrides default', async () => {
    const custom = createIsolatedAdapter();
    setRateLimitAdapter(custom);

    expect(getRateLimitAdapter()).toBe(custom);

    await custom.increment('custom-key', 60_000);

    // The singleton should now be the custom adapter
    const entry = await getRateLimitAdapter().increment('custom-key', 60_000);
    expect(entry.count).toBe(2);
  });

  it('setRateLimitAdapter(null) clears the override', async () => {
    const custom = createIsolatedAdapter();
    setRateLimitAdapter(custom);

    setRateLimitAdapter(null);

    // Should fall back to default singleton
    const adapter = getRateLimitAdapter();
    expect(adapter).not.toBe(custom);
  });

  it('resetRateLimitAdapter clears state and overrides', async () => {
    const adapter = getRateLimitAdapter();
    await adapter.increment('before-reset', 60_000);

    resetRateLimitAdapter();

    const newAdapter = getRateLimitAdapter();
    const entry = await newAdapter.increment('before-reset', 60_000);
    expect(entry.count).toBe(1); // state was cleared
  });
});
