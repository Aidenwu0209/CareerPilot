import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-020 tests: Protect /api/ai/models with authentication and active status guard
 *
 * Validates:
 * AC1: Unauthenticated access returns 401, no upstream calls
 * AC3: Suspended user rejected before external requests
 * AC4: Authenticated active user gets correct response
 * AC5: Rejected paths have zero external fetch calls
 */

// ── Hoisted mock functions ──

const { mockResolveUser, mockGetFingerprint } = vi.hoisted(() => ({
  mockResolveUser: vi.fn(),
  mockGetFingerprint: vi.fn(() => 'test-fp'),
}));

// ── Mock DB with in-memory SQLite ──

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });

  return { db, dbReady: Promise.resolve() };
});

vi.mock('@/lib/db/sample-resume', () => ({
  createSampleResume: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock auth helpers ──

vi.mock('@/lib/auth/helpers', () => ({
  resolveUser: mockResolveUser,
  getUserIdFromRequest: mockGetFingerprint,
}));

// ── Import AFTER mocks ──

import { GET } from './route';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

// ── Test data ──

const ACTIVE_USER_ID = 'u-active';
const SUSPENDED_USER_ID = 'u-suspended';

// ── Setup ──

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetFingerprint.mockReturnValue('test-fp');

  // Clean and seed users
  await db.delete(users);

  await db.insert(users).values({
    id: ACTIVE_USER_ID,
    email: 'active@test.com',
    name: 'Active',
    authType: 'oauth',
    platformRole: 'user',
    status: 'active',
  });
  await db.insert(users).values({
    id: SUSPENDED_USER_ID,
    email: 'suspended@test.com',
    name: 'Suspended',
    authType: 'oauth',
    platformRole: 'user',
    status: 'suspended',
  });

  // Spy on global fetch
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: 'gpt-4' }] }), { status: 200 }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function makeGetRequest(headers: Record<string, string> = {}) {
  return new NextRequest(new URL('http://localhost:3000/api/ai/models'), { headers });
}

// ═══════════════════════════════════════════════════

describe('US-020: GET /api/ai/models — authentication guard', () => {
  it('returns 401 when no authenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    const res = await GET(makeGetRequest({ 'x-api-key': 'test-key' }));
    expect(res.status).toBe(401);
  });

  it('makes zero fetch calls when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await GET(makeGetRequest({ 'x-api-key': 'test-key' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 ACCOUNT_SUSPENDED for suspended user', async () => {
    mockResolveUser.mockResolvedValue({
      id: SUSPENDED_USER_ID,
      email: 'suspended@test.com',
      name: 'Suspended',
      platformRole: 'user',
      status: 'suspended',
    });
    const res = await GET(makeGetRequest({ 'x-api-key': 'test-key' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('ACCOUNT_SUSPENDED');
  });

  it('makes zero fetch calls for suspended user', async () => {
    mockResolveUser.mockResolvedValue({
      id: SUSPENDED_USER_ID,
      email: 'suspended@test.com',
      name: 'Suspended',
      platformRole: 'user',
      status: 'suspended',
    });
    await GET(makeGetRequest({ 'x-api-key': 'test-key' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty models for active user without API key', async () => {
    mockResolveUser.mockResolvedValue({
      id: ACTIVE_USER_ID,
      email: 'active@test.com',
      name: 'Active',
      platformRole: 'user',
      status: 'active',
    });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches upstream models for active user with API key', async () => {
    mockResolveUser.mockResolvedValue({
      id: ACTIVE_USER_ID,
      email: 'active@test.com',
      name: 'Active',
      platformRole: 'user',
      status: 'active',
    });
    const res = await GET(makeGetRequest({
      'x-provider': 'openai',
      'x-api-key': 'test-key',
    }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(body.models[0].id).toBe('gpt-4');
  });

  it('does not expose API key in response', async () => {
    mockResolveUser.mockResolvedValue({
      id: ACTIVE_USER_ID,
      email: 'active@test.com',
      name: 'Active',
      platformRole: 'user',
      status: 'active',
    });
    const res = await GET(makeGetRequest({
      'x-provider': 'openai',
      'x-api-key': 'secret-key-123',
    }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret-key-123');
  });
});
