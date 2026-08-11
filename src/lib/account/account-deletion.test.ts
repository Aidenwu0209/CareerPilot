import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * US-080 tests: Account Deletion Service
 *
 * Validates:
 * AC1: Deletion requires re-auth OTP + one-time confirmation token
 * AC2: Success revokes sessions (auth accounts deleted), memberships, shares
 * AC3: Private data cascade-deleted (resumes, chats, interviews)
 * AC4: Retained records (ledger, audit, consents) reference anonymized user
 * AC5: Any step failure is recoverable — retry completes safely
 */

// --- Mock the DB module with an in-memory SQLite instance ---
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

// --- Mock audit service ---
vi.mock('@/lib/audit/audit-service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue('test-audit-id'),
}));

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('AUTH_SECRET', 'test-secret-with-sufficient-length-32chars!');

// --- Import AFTER mocks ---
import {
  issueDeletionToken,
  verifyDeletionToken,
  verifyOtpForReauth,
  initiateAccountDeletion,
  confirmAccountDeletion,
  deleteUserData,
} from './account-deletion';
import { db } from '@/lib/db';
import {
  users,
  authAccounts,
  resumes,
  resumeSections,
  resumeShares,
  chatSessions,
  chatMessages,
  interviewSessions,
  organizationMemberships,
  organizations,
} from '@/lib/db/schema';
import { creditAccounts } from '@/lib/db/schema-credits';
import { emailOtps } from '@/lib/db/schema';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { createHash, createHmac } from 'crypto';
import {
  careerProfiles,
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerTasks,
  careerProfileSnapshots,
  careerGuidanceNotes,
  careerMatches,
  educationRoleAssignments,
  teacherStudentAssignments,
  occupations,
  occupationRequirements,
  occupationRelations,
  careerKnowledgeDocuments,
} from '@/lib/db/schema-career';

// ── Helpers ──

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const id = overrides.id || crypto.randomUUID();
  await db.insert(users).values({
    id,
    email: `test-${id}@example.com`,
    authType: 'email',
    ...overrides,
  });
  return id;
}

async function createTestOtp(email: string, code: string = '123456') {
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(emailOtps).values({
    email: email.toLowerCase().trim(),
    codeHash,
    expiresAt,
  });
  return code;
}

async function createTestResume(userId: string) {
  const resumeId = crypto.randomUUID();
  await db.insert(resumes).values({
    id: resumeId,
    userId,
    title: 'Test Resume',
  });
  // Add a section
  await db.insert(resumeSections).values({
    resumeId,
    type: 'summary',
    title: 'Summary',
    content: { text: 'Test summary' },
  });
  // Add a share
  await db.insert(resumeShares).values({
    resumeId,
    token: `share-${resumeId}`,
  });
  // Add a chat session
  const sessionId = crypto.randomUUID();
  await db.insert(chatSessions).values({
    id: sessionId,
    resumeId,
  });
  await db.insert(chatMessages).values({
    sessionId,
    role: 'user',
    content: 'Test message',
  });
  return resumeId;
}

async function createTestInterview(userId: string) {
  const sessionId = crypto.randomUUID();
  await db.insert(interviewSessions).values({
    id: sessionId,
    userId,
    jobDescription: 'Test JD',
  });
  return sessionId;
}

async function createTestOrg(userId: string) {
  const orgId = crypto.randomUUID();
  await db.insert(organizations).values({
    id: orgId,
    slug: `org-${orgId.slice(0, 8)}`,
    name: 'Test Org',
    seatLimit: 10,
    createdBy: userId,
  });
  await db.insert(organizationMemberships).values({
    organizationId: orgId,
    userId,
    role: 'member',
    status: 'active',
  });
  return orgId;
}

async function createTestCreditAccount(userId: string, balance: number = 100) {
  const accountId = crypto.randomUUID();
  await db.insert(creditAccounts).values({
    id: accountId,
    ownerType: 'user',
    ownerId: userId,
    balance,
    status: 'active',
  });
  return accountId;
}

async function createTestCareerData(
  userId: string,
  teacherId: string,
  organizationId: string,
) {
  await db.insert(careerProfiles).values({ userId, headline: 'Frontend developer' });
  await db.insert(careerAbilities).values({
    userId,
    code: 'frontend-engineering',
    name: 'Frontend engineering',
    dimension: 'professional_skills',
    score: 78,
  });
  await db.insert(careerEvidence).values({
    userId,
    abilityCode: 'frontend-engineering',
    sourceType: 'project',
    title: 'Portfolio project',
  });
  const goalId = crypto.randomUUID();
  await db.insert(careerGoals).values({
    id: goalId,
    userId,
    occupationCode: 'OCC-DELETE-BOUNDARY',
    confirmedBy: teacherId,
  });
  await db.insert(careerTasks).values({
    userId,
    goalId,
    occupationCode: 'OCC-DELETE-BOUNDARY',
    title: 'Complete portfolio',
    assignedBy: teacherId,
  });
  await db.insert(careerProfileSnapshots).values({
    userId,
    version: 1,
    abilities: [{ code: 'frontend-engineering', score: 78 }],
  });
  await db.insert(careerMatches).values({
    userId,
    goalId,
    occupationCode: 'OCC-DELETE-BOUNDARY',
    score: 70,
  });
  await db.insert(educationRoleAssignments).values([
    { organizationId, userId, role: 'student' },
    { organizationId, userId, role: 'teacher' },
    { organizationId, userId: teacherId, role: 'teacher' },
  ]);
  await db.insert(teacherStudentAssignments).values({
    organizationId,
    teacherUserId: teacherId,
    studentUserId: userId,
  });
  await db.insert(careerGuidanceNotes).values({
    userId,
    teacherId,
    content: 'Student-facing guidance',
  });
}

beforeEach(async () => {
  // Clean all tables in dependency order
  await db.delete(teacherStudentAssignments);
  await db.delete(careerGuidanceNotes);
  await db.delete(careerMatches);
  await db.delete(careerTasks);
  await db.delete(careerProfileSnapshots);
  await db.delete(careerEvidence);
  await db.delete(careerAbilities);
  await db.delete(careerGoals);
  await db.delete(careerProfiles);
  await db.delete(educationRoleAssignments);
  await db.delete(occupationRequirements);
  await db.delete(occupationRelations);
  await db.delete(careerKnowledgeDocuments);
  await db.delete(occupations);
  await db.delete(chatMessages);
  await db.delete(chatSessions);
  await db.delete(resumeShares);
  await db.delete(resumeSections);
  await db.delete(resumes);
  await db.delete(interviewSessions);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(creditAccounts);
  await db.delete(authAccounts);
  await db.delete(emailOtps);
  await db.delete(users);

  vi.mocked(recordAuditEvent).mockClear();
});

// ── Token tests ──

describe('issueDeletionToken / verifyDeletionToken', () => {
  it('issues a token that verifies for the same userId', () => {
    const userId = crypto.randomUUID();
    const { token } = issueDeletionToken(userId);
    expect(verifyDeletionToken(token, userId)).toBe(true);
  });

  it('rejects a token for a different userId', () => {
    const userId = crypto.randomUUID();
    const { token } = issueDeletionToken(userId);
    expect(verifyDeletionToken(token, crypto.randomUUID())).toBe(false);
  });

  it('rejects an expired token', () => {
    const userId = crypto.randomUUID();
    // Create a token with past expiry by manipulating the format
    const pastExpiry = Date.now() - 1000;
    const nonce = 'aabbccdd';
    const payload = `${userId}:${pastExpiry}:${nonce}`;
    const sig = createHmac('sha256', process.env.AUTH_SECRET!).update(payload).digest('hex');
    const token = `${payload}:${sig}`;
    expect(verifyDeletionToken(token, userId)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const userId = crypto.randomUUID();
    const { token } = issueDeletionToken(userId);
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(verifyDeletionToken(tampered, userId)).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(verifyDeletionToken('garbage', 'user')).toBe(false);
    expect(verifyDeletionToken('', 'user')).toBe(false);
  });
});

// ── OTP re-auth tests ──

describe('verifyOtpForReauth', () => {
  it('verifies a valid OTP code', async () => {
    const email = 'test@example.com';
    const code = await createTestOtp(email, '654321');
    const result = await verifyOtpForReauth(email, code);
    expect(result).toBe(true);
  });

  it('rejects an invalid code', async () => {
    const email = 'test@example.com';
    await createTestOtp(email, '654321');
    const result = await verifyOtpForReauth(email, '000000');
    expect(result).toBe(false);
  });

  it('marks the code as used after verification', async () => {
    const email = 'test@example.com';
    const code = await createTestOtp(email, '999999');
    await verifyOtpForReauth(email, code);
    // Second attempt should fail
    const result = await verifyOtpForReauth(email, code);
    expect(result).toBe(false);
  });
});

// ── initiateAccountDeletion tests ──

describe('initiateAccountDeletion', () => {
  it('returns a token on valid OTP', async () => {
    const userId = await createTestUser({ email: 'delete@example.com' });
    const code = await createTestOtp('delete@example.com', '111222');

    const result = await initiateAccountDeletion(userId, 'delete@example.com', code);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token).toBeTruthy();
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it('returns error on invalid OTP', async () => {
    const userId = await createTestUser({ email: 'delete@example.com' });
    await createTestOtp('delete@example.com', '111222');

    const result = await initiateAccountDeletion(userId, 'delete@example.com', '000000');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INVALID_OTP');
    }
  });

  it('returns error when email is null', async () => {
    const userId = await createTestUser({ email: null, fingerprint: 'fp-test' });

    const result = await initiateAccountDeletion(userId, null, '123456');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('EMAIL_REQUIRED');
    }
  });
});

// ── deleteUserData tests ──

describe('deleteUserData', () => {
  it('deletes resumes and cascaded children', async () => {
    const userId = await createTestUser();
    const resumeId = await createTestResume(userId);

    await deleteUserData(userId);

    const resumeRows = await db.select().from(resumes).where(eq(resumes.id, resumeId));
    expect(resumeRows.length).toBe(0);

    const sectionRows = await db.select().from(resumeSections).where(eq(resumeSections.resumeId, resumeId));
    expect(sectionRows.length).toBe(0);
  });

  it('deletes interview sessions', async () => {
    const userId = await createTestUser();
    const sessionId = await createTestInterview(userId);

    await deleteUserData(userId);

    const rows = await db.select().from(interviewSessions).where(eq(interviewSessions.id, sessionId));
    expect(rows.length).toBe(0);
  });

  it('deletes auth accounts', async () => {
    const userId = await createTestUser();
    await db.insert(authAccounts).values({
      userId,
      provider: 'email',
      providerAccountId: `test-${userId}@example.com`,
    });

    await deleteUserData(userId);

    const rows = await db.select().from(authAccounts).where(eq(authAccounts.userId, userId));
    expect(rows.length).toBe(0);
  });

  it('soft-removes active organization memberships', async () => {
    const userId = await createTestUser();
    await createTestOrg(userId);

    await deleteUserData(userId);

    const rows = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, userId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('removed');
  });

  it('freezes personal credit accounts', async () => {
    const userId = await createTestUser();
    const accountId = await createTestCreditAccount(userId, 500);

    await deleteUserData(userId);

    const rows = await db.select().from(creditAccounts).where(eq(creditAccounts.id, accountId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('frozen');
  });

  it('anonymizes user PII and sets status to deleted', async () => {
    const userId = await createTestUser({
      email: 'pii@example.com',
      name: 'PII User',
      fingerprint: 'fp-pii',
      avatarUrl: 'https://example.com/avatar.png',
    });

    await deleteUserData(userId);

    const rows = await db.select().from(users).where(eq(users.id, userId));
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBeNull();
    expect(rows[0].name).toBeNull();
    expect(rows[0].fingerprint).toBeNull();
    expect(rows[0].avatarUrl).toBeNull();
    expect(rows[0].status).toBe('deleted');
  });

  it('deletes private career data and both directions of teacher-linked records', async () => {
    const userId = await createTestUser();
    const teacherId = await createTestUser();
    const otherStudentId = await createTestUser();
    const organizationId = await createTestOrg(userId);

    await db.insert(occupations).values({
      code: 'OCC-DELETE-BOUNDARY',
      name: 'Frontend Developer',
      category: 'Engineering',
      summary: 'Builds web user interfaces.',
      description: 'Shared occupation catalog entry.',
      entryLevel: 'Junior',
    });
    await db.insert(careerKnowledgeDocuments).values({
      id: 'shared-career-document',
      occupationCode: 'OCC-DELETE-BOUNDARY',
      title: 'Shared occupation guide',
      content: 'Shared RAG knowledge must survive user deletion.',
      sourceLabel: 'Test source',
      sourceUrl: 'https://example.com/shared-career-guide',
    });
    await createTestCareerData(userId, teacherId, organizationId);

    // The deleting user is also a teacher for another student. This direction
    // must be removed independently of their own student assignment.
    await db.insert(educationRoleAssignments).values({
      organizationId,
      userId: otherStudentId,
      role: 'student',
    });
    await db.insert(teacherStudentAssignments).values({
      organizationId,
      teacherUserId: userId,
      studentUserId: otherStudentId,
    });
    await db.insert(careerGuidanceNotes).values({
      userId: otherStudentId,
      teacherId: userId,
      content: 'Teacher-authored guidance for another student',
    });

    await deleteUserData(userId);

    expect(await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerAbilities).where(eq(careerAbilities.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerEvidence).where(eq(careerEvidence.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerGoals).where(eq(careerGoals.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerTasks).where(eq(careerTasks.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerProfileSnapshots).where(eq(careerProfileSnapshots.userId, userId))).toHaveLength(0);
    expect(await db.select().from(careerMatches).where(eq(careerMatches.userId, userId))).toHaveLength(0);

    const guidance = await db.select().from(careerGuidanceNotes);
    expect(guidance.find((note: typeof careerGuidanceNotes.$inferSelect) => (
      note.userId === userId || note.teacherId === userId
    ))).toBeUndefined();

    const assignments = await db.select().from(teacherStudentAssignments);
    expect(assignments.find((assignment: typeof teacherStudentAssignments.$inferSelect) => (
      assignment.teacherUserId === userId || assignment.studentUserId === userId
    ))).toBeUndefined();

    const educationRoles = await db
      .select()
      .from(educationRoleAssignments)
      .where(eq(educationRoleAssignments.userId, userId));
    expect(educationRoles).toHaveLength(2);
    expect(educationRoles.every((role: typeof educationRoleAssignments.$inferSelect) => (
      role.status === 'removed'
    ))).toBe(true);

    // Shared occupation graph/RAG catalog is not user-owned and must survive.
    expect(await db.select().from(occupations).where(eq(occupations.code, 'OCC-DELETE-BOUNDARY'))).toHaveLength(1);
    expect(await db.select().from(careerKnowledgeDocuments).where(eq(careerKnowledgeDocuments.id, 'shared-career-document'))).toHaveLength(1);
  });

  it('is idempotent — calling twice does not error', async () => {
    const userId = await createTestUser();
    await createTestResume(userId);
    await createTestInterview(userId);

    await deleteUserData(userId);
    // Second call should succeed without errors
    await deleteUserData(userId);

    const rows = await db.select().from(users).where(eq(users.id, userId));
    expect(rows[0].status).toBe('deleted');
  });
});

// ── confirmAccountDeletion tests ──

describe('confirmAccountDeletion', () => {
  it('rejects without a valid token', async () => {
    const userId = await createTestUser();

    const result = await confirmAccountDeletion(userId, 'invalid-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('INVALID_OR_EXPIRED_TOKEN');
    }
  });

  it('deletes account with valid token', async () => {
    const userId = await createTestUser({ email: 'confirm@example.com' });
    await createTestResume(userId);
    await createTestInterview(userId);
    await createTestCreditAccount(userId);

    const { token } = issueDeletionToken(userId);
    const result = await confirmAccountDeletion(userId, token);

    expect(result.success).toBe(true);

    // Verify user is anonymized
    const userRows = await db.select().from(users).where(eq(users.id, userId));
    expect(userRows[0].status).toBe('deleted');
    expect(userRows[0].email).toBeNull();
  });

  it('records an audit event', async () => {
    const userId = await createTestUser();
    const { token } = issueDeletionToken(userId);

    await confirmAccountDeletion(userId, token);

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        action: 'user.delete_account',
        targetType: 'user',
        result: 'success',
      }),
    );
  });

  it('returns success for already-deleted user (idempotent)', async () => {
    const userId = await createTestUser();
    await deleteUserData(userId);

    const { token } = issueDeletionToken(userId);
    const result = await confirmAccountDeletion(userId, token);

    expect(result.success).toBe(true);
  });

  it('returns error for non-existent user', async () => {
    const fakeUserId = crypto.randomUUID();
    const { token } = issueDeletionToken(fakeUserId);

    const result = await confirmAccountDeletion(fakeUserId, token);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('USER_NOT_FOUND');
    }
  });
});
