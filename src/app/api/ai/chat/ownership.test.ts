import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-018 tests: AI Chat & Chat Session ownership
 *
 * Validates:
 * AC1: AI Chat verifies resumeId belongs to current user before proceeding
 * AC2: sessionId verified to belong to that resume AND current user before writing
 * AC3: Session list/create/detail/messages/delete verify ownership via resume reverse-lookup
 * AC4: AI tools only created for resumes verified as belonging to current user
 * AC5: Cross-user requests return no-leak 404 with no writes or model calls
 */

// ── Hoisted mock functions ──

const { mockResolveUser, mockGetFingerprint } = vi.hoisted(() => ({
  mockResolveUser: vi.fn(),
  mockGetFingerprint: vi.fn(() => 'test-fp'),
}));

const { mockStreamText, mockConvertMessages, mockStepCountIs } = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockConvertMessages: vi.fn(async () => []),
  mockStepCountIs: vi.fn(() => true),
}));

const { mockCreateTools } = vi.hoisted(() => ({
  mockCreateTools: vi.fn(() => ({})),
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

// ── Mock AI modules (only relevant for chat route) ──

vi.mock('ai', () => ({
  streamText: mockStreamText,
  convertToModelMessages: mockConvertMessages,
  stepCountIs: mockStepCountIs,
}));

vi.mock('@/lib/ai/provider', () => ({
  getModel: vi.fn(() => ({})),
  extractAIConfig: vi.fn(() => ({})),
  AIConfigError: class AIConfigError extends Error {},
}));

vi.mock('@/lib/ai/prompts', () => ({
  getSystemPrompt: vi.fn(() => ''),
}));

vi.mock('@/lib/ai/tools', () => ({
  createExecutableTools: mockCreateTools,
}));

// ── Import AFTER mocks ──

import { POST as chatPost } from './route';
import { GET as sessionsGet, POST as sessionsPost } from './sessions/route';
import { GET as sessionDetailGet, DELETE as sessionDetailDelete } from './sessions/[sessionId]/route';
import { db } from '@/lib/db';
import { users, resumes, resumeSections, chatSessions, chatMessages } from '@/lib/db/schema';
import { count, eq } from 'drizzle-orm';

// ── Test data constants ──

const ALICE_ID = 'u-alice';
const BOB_ID = 'u-bob';
const ALICE_RESUME = 'r-alice';
const BOB_RESUME = 'r-bob';
const ALICE_SESSION = 's-alice';
const BOB_SESSION = 's-bob';

// ── Helpers ──

async function loginUser(userId: string) {
  const userMap: Record<string, { id: string; email: string; name: string }> = {
    [ALICE_ID]: { id: ALICE_ID, email: 'alice@test.com', name: 'Alice' },
    [BOB_ID]: { id: BOB_ID, email: 'bob@test.com', name: 'Bob' },
  };
  mockResolveUser.mockResolvedValue(userMap[userId]);
}

function makePostRequest(url: string, body: unknown) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGetRequest(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

async function getMessageCount(sessionId: string) {
  const result = await db.select({ cnt: count() }).from(chatMessages).where(eq(chatMessages.sessionId, sessionId));
  return Number(result[0]?.cnt ?? 0);
}

async function getSessionCount() {
  const result = await db.select({ cnt: count() }).from(chatSessions);
  return Number(result[0]?.cnt ?? 0);
}

// ── Setup ──

beforeEach(async () => {
  // Reset all mocks
  vi.clearAllMocks();
  mockGetFingerprint.mockReturnValue('test-fp');
  mockStreamText.mockReturnValue({
    toUIMessageStreamResponse: () => new Response('ok', { status: 200 }),
  });

  // Clean tables (child → parent order)
  await db.delete(chatMessages);
  await db.delete(chatSessions);
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(users);

  // Seed: Alice
  await db.insert(users).values({
    id: ALICE_ID,
    email: 'alice@test.com',
    name: 'Alice',
    authType: 'oauth',
  });
  await db.insert(resumes).values({
    id: ALICE_RESUME,
    userId: ALICE_ID,
    title: 'Alice Resume',
  });
  await db.insert(chatSessions).values({
    id: ALICE_SESSION,
    resumeId: ALICE_RESUME,
    title: 'Alice Chat',
  });
  await db.insert(chatMessages).values({
    id: 'm-alice-1',
    sessionId: ALICE_SESSION,
    role: 'user',
    content: 'Hello from Alice',
  });

  // Seed: Bob
  await db.insert(users).values({
    id: BOB_ID,
    email: 'bob@test.com',
    name: 'Bob',
    authType: 'oauth',
  });
  await db.insert(resumes).values({
    id: BOB_RESUME,
    userId: BOB_ID,
    title: 'Bob Resume',
  });
  await db.insert(chatSessions).values({
    id: BOB_SESSION,
    resumeId: BOB_RESUME,
    title: 'Bob Chat',
  });
  await db.insert(chatMessages).values({
    id: 'm-bob-1',
    sessionId: BOB_SESSION,
    role: 'user',
    content: 'Hello from Bob',
  });
});

// ═══════════════════════════════════════════════════
// AC1 + AC2 + AC4 + AC5: POST /api/ai/chat
// ═══════════════════════════════════════════════════

describe('US-018: POST /api/ai/chat — ownership checks', () => {
  it('returns 404 when resumeId belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: BOB_RESUME,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when resumeId does not exist', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: 'r-nonexistent',
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when sessionId belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: BOB_SESSION,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when sessionId does not exist', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 's-nonexistent',
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when sessionId does not match the provided resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: ALICE_RESUME,
      sessionId: BOB_SESSION,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when both resumeId and sessionId belong to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: BOB_RESUME,
      sessionId: BOB_SESSION,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(404);
  });

  it('does not call streamText when resumeId ownership fails', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: BOB_RESUME,
    });
    await chatPost(req);
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it('does not call createExecutableTools when resumeId ownership fails', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: BOB_RESUME,
    });
    await chatPost(req);
    expect(mockCreateTools).not.toHaveBeenCalled();
  });

  it('does not write messages when sessionId ownership fails', async () => {
    await loginUser(ALICE_ID);
    const beforeCount = await getMessageCount(BOB_SESSION);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: BOB_SESSION,
    });
    await chatPost(req);
    const afterCount = await getMessageCount(BOB_SESSION);
    expect(afterCount).toBe(beforeCount);
  });

  it('does not write messages or call AI when sessionId mismatches resumeId', async () => {
    await loginUser(ALICE_ID);
    const beforeCount = await getMessageCount(ALICE_SESSION);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: ALICE_RESUME,
      sessionId: BOB_SESSION,
    });
    await chatPost(req);
    expect(mockStreamText).not.toHaveBeenCalled();
    const afterCount = await getMessageCount(ALICE_SESSION);
    expect(afterCount).toBe(beforeCount);
  });

  it('proceeds to streamText when user owns the resume', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: ALICE_RESUME,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('creates tools only for the verified resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: ALICE_RESUME,
    });
    await chatPost(req);
    expect(mockCreateTools).toHaveBeenCalledWith(ALICE_RESUME, expect.anything());
  });

  it('proceeds when sessionId matches the owned resume', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      resumeId: ALICE_RESUME,
      sessionId: ALICE_SESSION,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('proceeds with only sessionId (no resumeId) when session belongs to user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: ALICE_SESSION,
    });
    const res = await chatPost(req);
    expect(res.status).toBe(200);
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════
// AC3: GET /api/ai/chat/sessions (list)
// ═══════════════════════════════════════════════════

describe('US-018: GET /api/ai/chat/sessions — ownership', () => {
  it('returns 404 when resumeId belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/ai/chat/sessions?resumeId=${BOB_RESUME}`);
    const res = await sessionsGet(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/ai/chat/sessions?resumeId=r-nonexistent`);
    const res = await sessionsGet(req);
    expect(res.status).toBe(404);
  });

  it('returns sessions for owned resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/ai/chat/sessions?resumeId=${ALICE_RESUME}`);
    const res = await sessionsGet(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe(ALICE_SESSION);
  });
});

// ═══════════════════════════════════════════════════
// AC3: POST /api/ai/chat/sessions (create)
// ═══════════════════════════════════════════════════

describe('US-018: POST /api/ai/chat/sessions — ownership', () => {
  it('returns 404 when resumeId belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat/sessions', { resumeId: BOB_RESUME });
    const res = await sessionsPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat/sessions', { resumeId: 'r-nonexistent' });
    const res = await sessionsPost(req);
    expect(res.status).toBe(404);
  });

  it('does not create a session for another user\'s resume', async () => {
    await loginUser(ALICE_ID);
    const beforeCount = await getSessionCount();
    const req = makePostRequest('/api/ai/chat/sessions', { resumeId: BOB_RESUME });
    await sessionsPost(req);
    const afterCount = await getSessionCount();
    expect(afterCount).toBe(beforeCount);
  });

  it('creates a session for owned resumeId', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/ai/chat/sessions', { resumeId: ALICE_RESUME });
    const res = await sessionsPost(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeDefined();
    expect(data.session.resumeId).toBe(ALICE_RESUME);
  });
});

// ═══════════════════════════════════════════════════
// AC3: GET /api/ai/chat/sessions/[sessionId] (detail + messages)
// ═══════════════════════════════════════════════════

describe('US-018: GET /api/ai/chat/sessions/[sessionId] — ownership', () => {
  it('returns 404 when session belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/ai/chat/sessions/${BOB_SESSION}`);
    const res = await sessionDetailGet(req, { params: Promise.resolve({ sessionId: BOB_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent session', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest('/api/ai/chat/sessions/s-nonexistent');
    const res = await sessionDetailGet(req, { params: Promise.resolve({ sessionId: 's-nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns session and messages when user owns it', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/ai/chat/sessions/${ALICE_SESSION}`);
    const res = await sessionDetailGet(req, { params: Promise.resolve({ sessionId: ALICE_SESSION }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.id).toBe(ALICE_SESSION);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].content).toBe('Hello from Alice');
  });
});

// ═══════════════════════════════════════════════════
// AC3 + AC5: DELETE /api/ai/chat/sessions/[sessionId]
// ═══════════════════════════════════════════════════

describe('US-018: DELETE /api/ai/chat/sessions/[sessionId] — ownership', () => {
  it('returns 404 when session belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const deleteReq = new NextRequest(new URL(`/api/ai/chat/sessions/${BOB_SESSION}`, 'http://localhost:3000'), {
      method: 'DELETE',
    });
    const res = await sessionDetailDelete(deleteReq, { params: Promise.resolve({ sessionId: BOB_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent session', async () => {
    await loginUser(ALICE_ID);
    const req = new NextRequest(new URL('/api/ai/chat/sessions/s-nonexistent', 'http://localhost:3000'), {
      method: 'DELETE',
    });
    const res = await sessionDetailDelete(req, { params: Promise.resolve({ sessionId: 's-nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('does not delete session when ownership fails', async () => {
    await loginUser(ALICE_ID);
    const req = new NextRequest(new URL(`/api/ai/chat/sessions/${BOB_SESSION}`, 'http://localhost:3000'), {
      method: 'DELETE',
    });
    await sessionDetailDelete(req, { params: Promise.resolve({ sessionId: BOB_SESSION }) });

    // Verify Bob's session still exists
    const result = await db.select().from(chatSessions).where(eq(chatSessions.id, BOB_SESSION)).limit(1);
    expect(result).toHaveLength(1);
  });

  it('deletes session when user owns it', async () => {
    await loginUser(ALICE_ID);
    const req = new NextRequest(new URL(`/api/ai/chat/sessions/${ALICE_SESSION}`, 'http://localhost:3000'), {
      method: 'DELETE',
    });
    const res = await sessionDetailDelete(req, { params: Promise.resolve({ sessionId: ALICE_SESSION }) });
    expect(res.status).toBe(200);

    // Verify session is gone
    const result = await db.select().from(chatSessions).where(eq(chatSessions.id, ALICE_SESSION)).limit(1);
    expect(result).toHaveLength(0);
  });
});
