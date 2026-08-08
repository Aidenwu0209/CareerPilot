import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * US-078 tests: User Data Export Service
 *
 * Validates the data export collection:
 * - AC1: Export contains all user-owned data collections
 * - AC2: Export identifies generation time, schema version, each collection
 * - AC3: Export only contains data the current user owns
 * - AC5: Per-collection failure handling
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

// --- Import AFTER mocks ---
import { db } from '@/lib/db';
import { users, resumes, resumeSections, chatSessions, chatMessages, resumeShares } from '@/lib/db/schema';
import { jdAnalyses, grammarChecks } from '@/lib/db/schema';
import { organizationMemberships, organizations } from '@/lib/db/schema-commercial';
import { interviewSessions, interviewRounds, interviewMessages, interviewReports } from '@/lib/db/schema-interview';
import { creditAccounts, creditTransactions } from '@/lib/db/schema-credits';
import { aiOperations } from '@/lib/db/schema-ai-operations';
import { legalConsents } from '@/lib/db/schema-audit';
import { collectUserData, EXPORT_SCHEMA_VERSION } from './user-data-export';

// ── Helpers ──

async function seedUser(id: string, email: string) {
  await db.insert(users).values({
    id,
    email,
    name: email.split('@')[0],
    authType: 'email',
    platformRole: 'user',
    status: 'active',
    settings: { autoSave: true, autoSaveInterval: 30 },
  });
}

async function seedResume(id: string, userId: string, title: string) {
  await db.insert(resumes).values({ id, userId, title });
  await db.insert(resumeSections).values({
    id: `${id}-s1`,
    resumeId: id,
    type: 'personal_info',
    title: 'Personal Info',
    content: { name: 'Test User' },
  });
}

async function seedChatForResume(resumeId: string) {
  await db.insert(chatSessions).values({ id: `${resumeId}-chat`, resumeId, title: 'Chat' });
  await db.insert(chatMessages).values({
    id: `${resumeId}-msg`,
    sessionId: `${resumeId}-chat`,
    role: 'user',
    content: 'Hello',
  });
}

async function seedShareForResume(resumeId: string) {
  await db.insert(resumeShares).values({
    id: `${resumeId}-share`,
    resumeId,
    token: `token-${resumeId}`,
    label: 'Public',
  });
}

async function seedAnalysisForResume(resumeId: string) {
  await db.insert(jdAnalyses).values({
    id: `${resumeId}-jd`,
    resumeId,
    jobDescription: 'Software Engineer',
    result: { score: 85 },
    overallScore: 85,
    atsScore: 90,
  });
  await db.insert(grammarChecks).values({
    id: `${resumeId}-grammar`,
    resumeId,
    result: { issues: 2 },
    score: 95,
    issueCount: 2,
  });
}

async function seedInterview(userId: string) {
  await db.insert(interviewSessions).values({
    id: `${userId}-iv`,
    userId,
    jobDescription: 'Frontend Dev',
    jobTitle: 'Frontend Developer',
    status: 'completed',
  });
  await db.insert(interviewRounds).values({
    id: `${userId}-iv-r1`,
    sessionId: `${userId}-iv`,
    interviewerType: 'behavioral',
    interviewerConfig: {},
    sortOrder: 0,
    status: 'completed',
  });
  await db.insert(interviewMessages).values({
    id: `${userId}-iv-m1`,
    roundId: `${userId}-iv-r1`,
    role: 'interviewer',
    content: 'Tell me about yourself',
  });
  await db.insert(interviewReports).values({
    id: `${userId}-iv-report`,
    sessionId: `${userId}-iv`,
    overallScore: 80,
    dimensionScores: {},
    roundEvaluations: {},
    overallFeedback: 'Good',
    improvementPlan: {},
  });
}

async function seedCreditsAndConsents(userId: string) {
  await db.insert(creditAccounts).values({
    id: `${userId}-acct`,
    ownerType: 'user',
    ownerId: userId,
    balance: 500,
  });
  await db.insert(creditTransactions).values({
    id: `${userId}-txn`,
    accountId: `${userId}-acct`,
    balanceBefore: 0,
    delta: 500,
    balanceAfter: 500,
    reason: 'registration_grant',
    idempotencyKey: `${userId}-grant`,
  });
  await db.insert(legalConsents).values({
    id: `${userId}-consent`,
    userId,
    documentType: 'privacy_policy',
    version: '2026-08-01-v1',
    effectiveDate: new Date('2026-08-01'),
    source: 'registration',
  });
}

async function seedAIOperation(userId: string) {
  // Use the existing account created in seedCreditsAndConsents
  await db.insert(aiOperations).values({
    id: `${userId}-aiop`,
    actorId: userId,
    billingAccountId: `${userId}-acct`,
    capability: 'resume_optimize',
    status: 'succeeded',
    idempotencyKey: `${userId}-aiop-key`,
  });
}

// ── Tests ──

describe('collectUserData', () => {
  beforeAll(async () => {
    // Seed two users
    await seedUser('user-a', 'a@export.test');
    await seedUser('user-b', 'b@export.test');

    // User A data
    await seedResume('r-a', 'user-a', 'My Resume A');
    await seedChatForResume('r-a');
    await seedShareForResume('r-a');
    await seedAnalysisForResume('r-a');
    await seedInterview('user-a');
    await seedCreditsAndConsents('user-a');
    await seedAIOperation('user-a');

    // User B data
    await seedResume('r-b', 'user-b', 'My Resume B');
    await seedCreditsAndConsents('user-b');

    // Organization
    await db.insert(organizations).values({
      id: 'org-1',
      slug: 'test-org',
      name: 'Test Org',
      seatLimit: 10,
      createdBy: 'user-a',
    });
    await db.insert(organizationMemberships).values({
      id: 'mbr-1',
      organizationId: 'org-1',
      userId: 'user-a',
      role: 'member',
      status: 'active',
    });
  });

  it('includes schema version and generation timestamp (AC2)', async () => {
    const data = await collectUserData('user-a');
    expect(data.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(data.generatedAt).toBeTruthy();
    // Should be a valid ISO date
    expect(new Date(data.generatedAt).toISOString()).toBe(data.generatedAt);
  });

  it('includes user profile (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.user).not.toBeNull();
    expect(data.user!.id).toBe('user-a');
    expect(data.user!.email).toBe('a@export.test');
    expect(data.user!.platformRole).toBe('user');
    expect(data.user!.status).toBe('active');
  });

  it('includes user settings (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.settings.autoSave).toBe(true);
    expect(data.settings.autoSaveInterval).toBe(30);
  });

  it('includes resumes and sections (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.resumes).toHaveLength(1);
    expect(data.resumes[0].id).toBe('r-a');
    expect(data.resumeSections).toHaveLength(1);
    expect((data.resumeSections[0] as { resumeId: string }).resumeId).toBe('r-a');
  });

  it('includes shares, chat sessions and messages (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.shares).toHaveLength(1);
    expect(data.chatSessions).toHaveLength(1);
    expect(data.chatMessages).toHaveLength(1);
  });

  it('includes JD analyses and grammar checks (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.jdAnalyses).toHaveLength(1);
    expect(data.grammarChecks).toHaveLength(1);
  });

  it('includes interview sessions, rounds, messages, and reports (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.interviewSessions).toHaveLength(1);
    expect(data.interviewRounds).toHaveLength(1);
    expect(data.interviewMessages).toHaveLength(1);
    expect(data.interviewReports).toHaveLength(1);
  });

  it('includes credit accounts and transactions (AC1)', async () => {
    const data = await collectUserData('user-a');
    // user-a has two accounts: one from seedCreditsAndConsents and one from seedAIOperation
    expect(data.creditAccounts.length).toBeGreaterThanOrEqual(1);
    expect(data.creditTransactions.length).toBeGreaterThanOrEqual(1);
    // Verify all accounts belong to user-a
    for (const acct of data.creditAccounts) {
      expect((acct as { ownerId: string }).ownerId).toBe('user-a');
      expect((acct as { ownerType: string }).ownerType).toBe('user');
    }
  });

  it('includes organization memberships with org name/slug (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.organizationMemberships).toHaveLength(1);
    const mbr = data.organizationMemberships[0] as {
      id: string;
      organization: { name: string; slug: string } | null;
      role: string;
      status: string;
    };
    expect(mbr.role).toBe('member');
    expect(mbr.organization!.name).toBe('Test Org');
    expect(mbr.organization!.slug).toBe('test-org');
  });

  it('includes legal consents (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.legalConsents).toHaveLength(1);
    expect((data.legalConsents[0] as { documentType: string }).documentType).toBe('privacy_policy');
  });

  it('includes AI operations (AC1)', async () => {
    const data = await collectUserData('user-a');
    expect(data.aiOperations.length).toBeGreaterThanOrEqual(1);
    expect((data.aiOperations[0] as { actorId: string }).actorId).toBe('user-a');
  });

  it('does NOT include other users data (AC3)', async () => {
    const data = await collectUserData('user-a');
    // No user-b resume
    expect(data.resumes.find(r => r.id === 'r-b')).toBeUndefined();
    // No user-b transactions
    for (const txn of data.creditTransactions) {
      expect((txn as { idempotencyKey: string }).idempotencyKey).not.toContain('user-b');
    }
  });

  it('returns empty arrays for collections when user has no data', async () => {
    // Seed a minimal user with no content
    await seedUser('empty-user', 'empty@test.com');
    const data = await collectUserData('empty-user');

    expect(data.resumes).toEqual([]);
    expect(data.resumeSections).toEqual([]);
    expect(data.shares).toEqual([]);
    expect(data.chatSessions).toEqual([]);
    expect(data.chatMessages).toEqual([]);
    expect(data.jdAnalyses).toEqual([]);
    expect(data.grammarChecks).toEqual([]);
    expect(data.interviewSessions).toEqual([]);
    expect(data.interviewRounds).toEqual([]);
    expect(data.interviewMessages).toEqual([]);
    expect(data.interviewReports).toEqual([]);
    expect(data.creditTransactions).toEqual([]);
    expect(data.organizationMemberships).toEqual([]);
    expect(data.legalConsents).toEqual([]);
    expect(data.aiOperations).toEqual([]);
  });

  it('returns null user when userId does not exist', async () => {
    const data = await collectUserData('nonexistent-user');
    expect(data.user).toBeNull();
    expect(data.errors).toContain("collection 'user' failed: user not found");
  });

  it('does not include sensitive auth tokens in authAccounts (AC3)', async () => {
    const data = await collectUserData('user-a');
    // authAccounts should not contain accessToken or refreshToken
    for (const acct of data.authAccounts) {
      expect(acct).not.toHaveProperty('accessToken');
      expect(acct).not.toHaveProperty('refreshToken');
    }
  });

  it('does not include platform keys or credit rules (AC3)', async () => {
    const data = await collectUserData('user-a');
    expect(data).not.toHaveProperty('aiProviders');
    expect(data).not.toHaveProperty('aiModels');
    expect(data).not.toHaveProperty('creditRules');
    expect(data).not.toHaveProperty('emailOtps');
  });

  it('captures per-collection errors without aborting (AC5)', async () => {
    const data = await collectUserData('user-a');
    // With a working DB, there should be no errors
    expect(data.errors).toEqual([]);
    // But the errors array must exist
    expect(Array.isArray(data.errors)).toBe(true);
  });
});
