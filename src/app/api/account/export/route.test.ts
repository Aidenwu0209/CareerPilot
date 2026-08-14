import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * US-078 tests: Export API route
 *
 * Validates the HTTP API for data export:
 * - Unauthenticated → 401
 * - Suspended → 403
 * - Valid session → 200 with downloadable JSON
 */

// --- Mock the DB module with in-memory SQLite ---
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

// --- Mock @/lib/auth/guards ---
const ctxOverrides: { userId: string | null; suspended: boolean } = {
  userId: null,
  suspended: false,
};

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (ctxOverrides.userId === null) return null;
    if (ctxOverrides.suspended) {
      return {
        ok: false as const,
        response: new Response(JSON.stringify({ error: 'ACCOUNT_SUSPENDED' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      };
    }
    return {
      ok: true as const,
      context: {
        actor: { userId: ctxOverrides.userId, platformRole: 'user' as const, status: 'active' as const },
        tenant: { type: 'none' as const, organizationId: null, orgRole: null },
        billing: { accountOwnerType: 'user' as const, accountOwnerId: ctxOverrides.userId },
      },
    };
  }),
}));

// --- Import AFTER mocks ---
import { POST } from './route';
import { db } from '@/lib/db';
import { users, resumes } from '@/lib/db/schema';

async function seedUser(id: string, email: string) {
  await db.insert(users).values({
    id,
    email,
    name: email.split('@')[0],
    authType: 'email',
    platformRole: 'user',
    status: 'active',
  });
}

function setContext(userId: string | null, suspended = false) {
  ctxOverrides.userId = userId;
  ctxOverrides.suspended = suspended;
}

describe('POST /api/account/export', () => {
  beforeAll(async () => {
    await seedUser('exp-user', 'exp@test.com');
    await db.insert(resumes).values({ id: 'exp-resume', userId: 'exp-user', title: 'Export Test' });
  });

  it('returns 401 for unauthenticated requests', async () => {
    setContext(null);
    const res = await POST();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('returns 403 for suspended users', async () => {
    setContext('exp-user', true);
    const res = await POST();
    expect(res.status).toBe(403);
    setContext('exp-user', false); // reset
  });

  it('returns 200 with JSON export for authenticated user', async () => {
    setContext('exp-user');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');

    const body = await res.json();
    expect(body.schemaVersion).toBe(3);
    expect(body.generatedAt).toBeTruthy();
    expect(body.user.id).toBe('exp-user');
    expect(body.resumes).toHaveLength(1);
    expect(body.resumes[0].id).toBe('exp-resume');
    expect(body.errors).toEqual([]);
  });

  it('Content-Disposition contains a non-guessable filename', async () => {
    setContext('exp-user');
    const res = await POST();
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toContain('careerpilot-export-');
    expect(disposition).toContain('.json');
  });
});
