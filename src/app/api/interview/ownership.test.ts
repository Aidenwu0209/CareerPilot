import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * US-019 tests: Interview nested resource ownership
 *
 * Validates:
 * AC1: Creating an interview with resumeId verifies the resume belongs to the current user
 * AC2: Interview report GET verifies the session belongs to the current user
 * AC3: Control endpoint with roundId verifies the round belongs to the URL's current session
 * AC4: Mark endpoint with messageId verifies the message belongs to the current session and user
 * AC5: Cross-user requests return no-leak 404, no updates to sessions, rounds, messages, or reports
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

import { POST as interviewPost } from './route';
import { GET as reportGet } from './[id]/report/route';
import { POST as controlPost } from './[id]/control/route';
import { POST as markPost } from './[id]/mark/route';
import { db } from '@/lib/db';
import {
  users,
  resumes,
  resumeSections,
  interviewSessions,
  interviewRounds,
  interviewMessages,
  interviewReports,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// ── Test data constants ──

const ALICE_ID = 'u-alice';
const BOB_ID = 'u-bob';
const ALICE_RESUME = 'r-alice';
const BOB_RESUME = 'r-bob';
const ALICE_SESSION = 's-alice';
const BOB_SESSION = 's-bob';
const ALICE_ROUND = 'rd-alice';
const BOB_ROUND = 'rd-bob';
const ALICE_MSG = 'm-alice';
const BOB_MSG = 'm-bob';
const ALICE_REPORT = 'rep-alice';

// ── Helpers ──

async function loginUser(userId: string) {
  const userMap: Record<string, { id: string; email: string; name: string; platformRole: 'super_admin' | 'user'; status: 'active' | 'suspended' | 'deleted'; fingerprint: null; authType: string; avatarUrl: string | null; settings: unknown; createdAt: Date; updatedAt: Date }> = {
    [ALICE_ID]: { id: ALICE_ID, email: 'alice@test.com', name: 'Alice', platformRole: 'user', status: 'active', fingerprint: null, authType: 'fingerprint', avatarUrl: null, settings: {}, createdAt: new Date(), updatedAt: new Date() },
    [BOB_ID]: { id: BOB_ID, email: 'bob@test.com', name: 'Bob', platformRole: 'user', status: 'active', fingerprint: null, authType: 'fingerprint', avatarUrl: null, settings: {}, createdAt: new Date(), updatedAt: new Date() },
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

async function getRoundStatus(roundId: string) {
  const result = await db.select({ status: interviewRounds.status }).from(interviewRounds).where(eq(interviewRounds.id, roundId)).limit(1);
  return result[0]?.status ?? null;
}

async function getMessageMetadata(messageId: string) {
  const result = await db.select({ metadata: interviewMessages.metadata }).from(interviewMessages).where(eq(interviewMessages.id, messageId)).limit(1);
  return result[0]?.metadata ?? null;
}

async function getSessionStatus(sessionId: string) {
  const result = await db.select({ status: interviewSessions.status }).from(interviewSessions).where(eq(interviewSessions.id, sessionId)).limit(1);
  return result[0]?.status ?? null;
}

// ── Setup ──

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetFingerprint.mockReturnValue('test-fp');

  // Clean tables (child → parent order)
  await db.delete(interviewReports);
  await db.delete(interviewMessages);
  await db.delete(interviewRounds);
  await db.delete(interviewSessions);
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(users);

  // Seed: Alice
  await db.insert(users).values({ id: ALICE_ID, email: 'alice@test.com', name: 'Alice', authType: 'oauth' });
  await db.insert(resumes).values({ id: ALICE_RESUME, userId: ALICE_ID, title: 'Alice Resume' });
  await db.insert(interviewSessions).values({
    id: ALICE_SESSION,
    userId: ALICE_ID,
    resumeId: ALICE_RESUME,
    jobDescription: 'Frontend Developer',
    jobTitle: 'Frontend Dev',
    selectedInterviewers: [],
    status: 'in_progress',
  });
  await db.insert(interviewRounds).values({
    id: ALICE_ROUND,
    sessionId: ALICE_SESSION,
    interviewerType: 'technical',
    interviewerConfig: {},
    sortOrder: 0,
    status: 'in_progress',
  });
  await db.insert(interviewMessages).values({
    id: ALICE_MSG,
    roundId: ALICE_ROUND,
    role: 'interviewer',
    content: 'Tell me about yourself',
    metadata: {},
  });

  // Seed: Bob
  await db.insert(users).values({ id: BOB_ID, email: 'bob@test.com', name: 'Bob', authType: 'oauth' });
  await db.insert(resumes).values({ id: BOB_RESUME, userId: BOB_ID, title: 'Bob Resume' });
  await db.insert(interviewSessions).values({
    id: BOB_SESSION,
    userId: BOB_ID,
    resumeId: BOB_RESUME,
    jobDescription: 'Backend Developer',
    jobTitle: 'Backend Dev',
    selectedInterviewers: [],
    status: 'in_progress',
  });
  await db.insert(interviewRounds).values({
    id: BOB_ROUND,
    sessionId: BOB_SESSION,
    interviewerType: 'technical',
    interviewerConfig: {},
    sortOrder: 0,
    status: 'in_progress',
  });
  await db.insert(interviewMessages).values({
    id: BOB_MSG,
    roundId: BOB_ROUND,
    role: 'interviewer',
    content: 'Explain REST API',
    metadata: {},
  });
});

describe('Interview API authentication response', () => {
  it('returns a JSON AUTH_REQUIRED response instead of plain text', async () => {
    mockResolveUser.mockResolvedValue(null);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'Frontend Developer',
      jobTitle: 'Frontend Dev',
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });

    const res = await interviewPost(req);

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'AUTH_REQUIRED' });
  });
});

// ═══════════════════════════════════════════════════
// AC1: POST /api/interview — resumeId ownership
// ═══════════════════════════════════════════════════

describe('US-019: POST /api/interview — resumeId ownership', () => {
  it('returns 404 when resumeId belongs to another user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'DevOps Engineer',
      jobTitle: 'DevOps',
      resumeId: BOB_RESUME,
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });
    const res = await interviewPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when resumeId does not exist', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'DevOps Engineer',
      jobTitle: 'DevOps',
      resumeId: 'r-nonexistent',
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });
    const res = await interviewPost(req);
    expect(res.status).toBe(404);
  });

  it('creates session when resumeId belongs to user', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'DevOps Engineer',
      jobTitle: 'DevOps',
      resumeId: ALICE_RESUME,
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });
    const res = await interviewPost(req);
    expect(res.status).toBe(201);
  });

  it('creates session without resumeId (no ownership to check)', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'DevOps Engineer',
      jobTitle: 'DevOps',
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });
    const res = await interviewPost(req);
    expect(res.status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════
// AC2: GET /api/interview/[id]/report — session ownership
// ═══════════════════════════════════════════════════

describe('US-019: GET /api/interview/[id]/report — session ownership', () => {
  beforeEach(async () => {
    // Seed Alice's report
    await db.insert(interviewReports).values({
      id: ALICE_REPORT,
      sessionId: ALICE_SESSION,
      overallScore: 85,
      dimensionScores: [],
      roundEvaluations: [],
      overallFeedback: 'Good candidate',
      improvementPlan: [],
    });
  });

  it('returns 404 when session belongs to another user', async () => {
    await loginUser(BOB_ID);
    const req = makeGetRequest(`/api/interview/${ALICE_SESSION}/report`);
    const res = await reportGet(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('returns report when session belongs to user', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/interview/${ALICE_SESSION}/report`);
    const res = await reportGet(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.overallScore).toBe(85);
  });

  it('returns 404 for non-existent session', async () => {
    await loginUser(ALICE_ID);
    const req = makeGetRequest('/api/interview/s-nonexistent/report');
    const res = await reportGet(req, { params: Promise.resolve({ id: 's-nonexistent' }) });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════
// AC3: POST /api/interview/[id]/control — roundId ownership
// ═══════════════════════════════════════════════════

describe('US-019: POST /api/interview/[id]/control — roundId ownership', () => {
  it('returns 404 when roundId belongs to another session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'skip',
      roundId: BOB_ROUND,
    });
    const res = await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when roundId does not exist', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'skip',
      roundId: 'rd-nonexistent',
    });
    const res = await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('does not update round status when roundId belongs to another session', async () => {
    await loginUser(ALICE_ID);
    const beforeStatus = await getRoundStatus(BOB_ROUND);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'end_round',
      roundId: BOB_ROUND,
    });
    await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    const afterStatus = await getRoundStatus(BOB_ROUND);
    expect(afterStatus).toBe(beforeStatus);
  });

  it('does not add system message when roundId belongs to another session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'skip',
      roundId: BOB_ROUND,
    });
    await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });

    // Bob's round should have no new messages
    const msgs = await db.select().from(interviewMessages).where(eq(interviewMessages.roundId, BOB_ROUND));
    expect(msgs).toHaveLength(1); // Only the seeded message
  });

  it('proceeds when roundId belongs to the session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'skip',
      roundId: ALICE_ROUND,
    });
    const res = await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(200);
  });

  it('completes round when roundId matches session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'end_round',
      roundId: ALICE_ROUND,
    });
    const res = await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(200);
    const status = await getRoundStatus(ALICE_ROUND);
    expect(status).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════
// AC4: POST /api/interview/[id]/mark — message ownership
// ═══════════════════════════════════════════════════

describe('US-019: POST /api/interview/[id]/mark — message ownership', () => {
  it('returns 404 when message belongs to another user\'s session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/mark`, {
      messageId: BOB_MSG,
      marked: true,
    });
    const res = await markPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when messageId does not exist', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/mark`, {
      messageId: 'm-nonexistent',
      marked: true,
    });
    const res = await markPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(404);
  });

  it('does not update message metadata when ownership fails', async () => {
    await loginUser(ALICE_ID);
    const beforeMeta = await getMessageMetadata(BOB_MSG);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/mark`, {
      messageId: BOB_MSG,
      marked: true,
    });
    await markPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    const afterMeta = await getMessageMetadata(BOB_MSG);
    expect(afterMeta).toEqual(beforeMeta);
  });

  it('updates message metadata when message belongs to session', async () => {
    await loginUser(ALICE_ID);
    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/mark`, {
      messageId: ALICE_MSG,
      marked: true,
    });
    const res = await markPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });
    expect(res.status).toBe(200);
    const meta = await getMessageMetadata(ALICE_MSG);
    expect((meta as Record<string, unknown>)?.marked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════
// AC5: Cross-user no-leak 404 with no side effects
// ═══════════════════════════════════════════════════

describe('US-019: AC5 — cross-user no-leak and no side effects', () => {
  it('interview POST with Bob\'s resumeId does not create a session', async () => {
    await loginUser(ALICE_ID);
    const beforeCount = await db.select({ cnt: interviewSessions.id }).from(interviewSessions);
    const req = makePostRequest('/api/interview', {
      jobDescription: 'DevOps',
      jobTitle: 'DevOps',
      resumeId: BOB_RESUME,
      interviewers: [{ type: 'technical', name: 'Tech' }],
    });
    await interviewPost(req);
    const afterCount = await db.select({ cnt: interviewSessions.id }).from(interviewSessions);
    expect(afterCount.length).toBe(beforeCount.length);
  });

  it('report GET for Bob\'s session returns 404 for Alice', async () => {
    // Create Bob's report
    await db.insert(interviewReports).values({
      id: 'rep-bob',
      sessionId: BOB_SESSION,
      overallScore: 70,
      dimensionScores: [],
      roundEvaluations: [],
      overallFeedback: 'Bob feedback',
      improvementPlan: [],
    });

    await loginUser(ALICE_ID);
    const req = makeGetRequest(`/api/interview/${BOB_SESSION}/report`);
    const res = await reportGet(req, { params: Promise.resolve({ id: BOB_SESSION }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    // Response should not leak Bob's report data
    expect(body.overallFeedback).toBeUndefined();
  });

  it('control with Bob\'s roundId does not modify Bob\'s round or session', async () => {
    await loginUser(ALICE_ID);
    const beforeRoundStatus = await getRoundStatus(BOB_ROUND);
    const beforeSessionStatus = await getSessionStatus(BOB_SESSION);

    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/control`, {
      action: 'end_round',
      roundId: BOB_ROUND,
    });
    await controlPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });

    expect(await getRoundStatus(BOB_ROUND)).toBe(beforeRoundStatus);
    expect(await getSessionStatus(BOB_SESSION)).toBe(beforeSessionStatus);
  });

  it('mark with Bob\'s messageId does not modify Bob\'s message', async () => {
    await loginUser(ALICE_ID);
    const beforeMeta = await getMessageMetadata(BOB_MSG);

    const req = makePostRequest(`/api/interview/${ALICE_SESSION}/mark`, {
      messageId: BOB_MSG,
      marked: true,
    });
    await markPost(req, { params: Promise.resolve({ id: ALICE_SESSION }) });

    const afterMeta = await getMessageMetadata(BOB_MSG);
    expect(afterMeta).toEqual(beforeMeta);
  });
});
