import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-020 tests: Protect /api/linkedin-photo with authentication and active status guard
 *
 * Validates:
 * AC2: Unauthenticated access returns 401, no anonymous high-cost calls
 * AC3: Suspended user rejected before external requests
 * AC4: Authenticated existing user still gets response, no provider key exposure
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

import { POST } from './route';
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

  // Spy on global fetch — mock a successful Gemini response
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: 'Here is your photo' },
              { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
            ],
          },
        }],
      }),
      { status: 200 },
    ),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function makePostRequest(body: unknown) {
  return new NextRequest(new URL('http://localhost:3000/api/linkedin-photo'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const VALID_BODY = {
  image: 'data:image/jpeg;base64,/9j/4AAQ',
  prompt: 'Professional headshot',
  apiKey: 'test-gemini-key',
};

// ═══════════════════════════════════════════════════

describe('US-020: POST /api/linkedin-photo — authentication guard', () => {
  it('returns 401 when no authenticated user', async () => {
    mockResolveUser.mockResolvedValue(null);
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('makes zero fetch calls when unauthenticated', async () => {
    mockResolveUser.mockResolvedValue(null);
    await POST(makePostRequest(VALID_BODY));
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
    const res = await POST(makePostRequest(VALID_BODY));
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
    await POST(makePostRequest(VALID_BODY));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proceeds to generate photo for active user', async () => {
    mockResolveUser.mockResolvedValue({
      id: ACTIVE_USER_ID,
      email: 'active@test.com',
      name: 'Active',
      platformRole: 'user',
      status: 'active',
    });
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.image).toBeDefined();
  });

  it('does not expose API key in response', async () => {
    mockResolveUser.mockResolvedValue({
      id: ACTIVE_USER_ID,
      email: 'active@test.com',
      name: 'Active',
      platformRole: 'user',
      status: 'active',
    });
    const res = await POST(makePostRequest({ ...VALID_BODY, apiKey: 'super-secret-key' }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('super-secret-key');
  });
});
