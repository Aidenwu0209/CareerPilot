/**
 * User Data Export Service (US-078)
 *
 * Collects all user-owned data for GDPR-style data portability.
 * Each collection is fetched independently — failures are captured per-collection
 * rather than aborting the entire export.
 *
 * Security:
 * - Only collects data owned by the target userId
 * - Excludes platform secrets (AI provider keys, system rules)
 * - Excludes auth tokens (accessToken/refreshToken are redacted)
 * - Excludes OTP codes
 * - Excludes other users' data in shared organizations
 */

import { db } from '@/lib/db';
import {
  users,
  authAccounts,
  resumes,
  resumeSections,
  chatSessions,
  chatMessages,
  resumeShares,
  jdAnalyses,
  grammarChecks,
  organizationMemberships,
  organizations,
  careerProfiles,
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerTasks,
  careerProfileSnapshots,
  careerGuidanceNotes,
  careerMatches,
  educationRoleAssignments,
  supportTickets,
} from '@/lib/db/schema';
import {
  interviewSessions,
  interviewRounds,
  interviewMessages,
  interviewReports,
} from '@/lib/db/schema-interview';
import {
  creditAccounts,
  creditTransactions,
} from '@/lib/db/schema-credits';
import {
  aiOperations,
} from '@/lib/db/schema-ai-operations';
import {
  legalConsents,
} from '@/lib/db/schema-audit';
import { and, eq, inArray, desc } from 'drizzle-orm';

// ── Types ──

export const EXPORT_SCHEMA_VERSION = 3;

export interface UserDataExport {
  schemaVersion: number;
  generatedAt: string;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
    authType: string;
    platformRole: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  settings: Record<string, unknown>;
  authAccounts: Array<{
    id: string;
    provider: string;
    providerAccountId: string;
    tokenType: string | null;
    expiresAt: string | null;
    scope: string | null;
    createdAt: string;
  }>;
  resumes: Array<Record<string, unknown>>;
  resumeSections: Array<Record<string, unknown>>;
  shares: Array<Record<string, unknown>>;
  chatSessions: Array<Record<string, unknown>>;
  chatMessages: Array<Record<string, unknown>>;
  jdAnalyses: Array<Record<string, unknown>>;
  grammarChecks: Array<Record<string, unknown>>;
  interviewSessions: Array<Record<string, unknown>>;
  interviewRounds: Array<Record<string, unknown>>;
  interviewMessages: Array<Record<string, unknown>>;
  interviewReports: Array<Record<string, unknown>>;
  creditAccounts: Array<Record<string, unknown>>;
  creditTransactions: Array<Record<string, unknown>>;
  organizationMemberships: Array<Record<string, unknown>>;
  educationRoleAssignments: Array<Record<string, unknown>>;
  careerProfiles: Array<Record<string, unknown>>;
  careerAbilities: Array<Record<string, unknown>>;
  careerEvidence: Array<Record<string, unknown>>;
  careerGoals: Array<Record<string, unknown>>;
  careerTasks: Array<Record<string, unknown>>;
  careerProfileSnapshots: Array<Record<string, unknown>>;
  careerGuidanceNotes: Array<Record<string, unknown>>;
  careerMatches: Array<Record<string, unknown>>;
  legalConsents: Array<Record<string, unknown>>;
  aiOperations: Array<Record<string, unknown>>;
  supportTickets: Array<Record<string, unknown>>;
  errors: string[];
}

// ── Helper: safely collect a collection ──

async function safeCollect<T>(
  name: string,
  fn: () => Promise<T>,
  errors: string[],
): Promise<T | []> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`collection '${name}' failed: ${msg}`);
    return [];
  }
}

/**
 * Remove references to other users before adding a row to a user's portable
 * export. Review/audit metadata remains useful, but internal actor identifiers
 * are not part of the student's data and must not cross that privacy boundary.
 */
function stripOtherUserReferences(
  row: unknown,
  keys: string[],
): Record<string, unknown> {
  const sanitized = { ...(row as Record<string, unknown>) };
  for (const key of keys) delete sanitized[key];
  return sanitized;
}

// ── Main export function ──

export async function collectUserData(userId: string): Promise<UserDataExport> {
  const errors: string[] = [];
  const generatedAt = new Date().toISOString();

  // ── User profile ──
  const userRows = await safeCollect('user', async () => {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    if (rows.length === 0) throw new Error('user not found');
    return rows;
  }, errors);

  const userProfile = (userRows && userRows.length > 0) ? {
    id: userRows[0].id,
    email: userRows[0].email,
    name: userRows[0].name,
    avatarUrl: userRows[0].avatarUrl,
    authType: userRows[0].authType,
    platformRole: userRows[0].platformRole,
    status: userRows[0].status,
    createdAt: userRows[0].createdAt.toISOString(),
    updatedAt: userRows[0].updatedAt.toISOString(),
  } : null;

  // ── Settings (from users.settings JSON column, strip legacy keys) ──
  let settings: Record<string, unknown> = {};
  if (userProfile) {
    const rawSettings = (userRows as Array<typeof users.$inferSelect>)[0]?.settings;
    if (rawSettings && typeof rawSettings === 'object') {
      settings = { ...(rawSettings as Record<string, unknown>) };
      // Strip legacy sensitive keys
      delete settings.aiProvider;
      delete (settings as Record<string, unknown>).aiBaseURL;
      delete (settings as Record<string, unknown>).aiModel;
    }
  }

  // ── Auth accounts (redact tokens) ──
  const authAccountRows = await safeCollect('authAccounts', async () => {
    const rows = await db.select().from(authAccounts).where(eq(authAccounts.userId, userId));
    return rows.map((r: typeof authAccounts.$inferSelect) => ({
      id: r.id,
      provider: r.provider,
      providerAccountId: r.providerAccountId,
      tokenType: r.tokenType,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      scope: r.scope,
      createdAt: r.createdAt.toISOString(),
    }));
  }, errors);

  // ── Resumes ──
  const resumeRows = await safeCollect('resumes', async () => {
    return await db.select().from(resumes).where(eq(resumes.userId, userId));
  }, errors);

  const resumeIds = (resumeRows as Array<typeof resumes.$inferSelect>).map(r => r.id);

  // ── Resume sections (only for user's resumes) ──
  const sectionRows = await safeCollect('resumeSections', async () => {
    if (resumeIds.length === 0) return [];
    return await db.select().from(resumeSections).where(inArray(resumeSections.resumeId, resumeIds));
  }, errors);

  // ── Shares (only for user's resumes) ──
  const shareRows = await safeCollect('shares', async () => {
    if (resumeIds.length === 0) return [];
    return await db.select().from(resumeShares).where(inArray(resumeShares.resumeId, resumeIds));
  }, errors);

  // ── Chat sessions (only for user's resumes) ──
  const chatSessionRows = await safeCollect('chatSessions', async () => {
    if (resumeIds.length === 0) return [];
    return await db.select().from(chatSessions).where(inArray(chatSessions.resumeId, resumeIds));
  }, errors);

  const chatSessionIds = (chatSessionRows as Array<typeof chatSessions.$inferSelect>).map(s => s.id);

  // ── Chat messages (only for user's chat sessions) ──
  const chatMessageRows = await safeCollect('chatMessages', async () => {
    if (chatSessionIds.length === 0) return [];
    return await db.select().from(chatMessages).where(inArray(chatMessages.sessionId, chatSessionIds));
  }, errors);

  // ── JD analyses (only for user's resumes) ──
  const jdRows = await safeCollect('jdAnalyses', async () => {
    if (resumeIds.length === 0) return [];
    return await db.select().from(jdAnalyses).where(inArray(jdAnalyses.resumeId, resumeIds));
  }, errors);

  // ── Grammar checks (only for user's resumes) ──
  const grammarRows = await safeCollect('grammarChecks', async () => {
    if (resumeIds.length === 0) return [];
    return await db.select().from(grammarChecks).where(inArray(grammarChecks.resumeId, resumeIds));
  }, errors);

  // ── Interview sessions (owned by user) ──
  const interviewSessionRows = await safeCollect('interviewSessions', async () => {
    return await db.select().from(interviewSessions).where(eq(interviewSessions.userId, userId));
  }, errors);

  const interviewSessionIds = (interviewSessionRows as Array<typeof interviewSessions.$inferSelect>).map(s => s.id);

  // ── Interview rounds (for user's sessions) ──
  const interviewRoundRows = await safeCollect('interviewRounds', async () => {
    if (interviewSessionIds.length === 0) return [];
    return await db.select().from(interviewRounds).where(inArray(interviewRounds.sessionId, interviewSessionIds));
  }, errors);

  const interviewRoundIds = (interviewRoundRows as Array<typeof interviewRounds.$inferSelect>).map(r => r.id);

  // ── Interview messages (for user's rounds) ──
  const interviewMessageRows = await safeCollect('interviewMessages', async () => {
    if (interviewRoundIds.length === 0) return [];
    return await db.select().from(interviewMessages).where(inArray(interviewMessages.roundId, interviewRoundIds));
  }, errors);

  // ── Interview reports (for user's sessions) ──
  const interviewReportRows = await safeCollect('interviewReports', async () => {
    if (interviewSessionIds.length === 0) return [];
    return await db.select().from(interviewReports).where(inArray(interviewReports.sessionId, interviewSessionIds));
  }, errors);

  // ── Credit accounts (personal accounts only) ──
  const creditAccountRows = await safeCollect('creditAccounts', async () => {
    return await db.select().from(creditAccounts).where(eq(creditAccounts.ownerType, 'user'));
  }, errors);

  // Filter to only this user's personal accounts
  const userAccountIds = (creditAccountRows as Array<typeof creditAccounts.$inferSelect>)
    .filter(a => a.ownerId === userId)
    .map(a => a.id);

  // ── Credit transactions (for user's personal accounts) ──
  const creditTransactionRows = await safeCollect('creditTransactions', async () => {
    if (userAccountIds.length === 0) return [];
    return await db.select().from(creditTransactions).where(inArray(creditTransactions.accountId, userAccountIds)).orderBy(desc(creditTransactions.createdAt));
  }, errors);

  // ── Organization memberships (user's memberships) ──
  const membershipRows = await safeCollect('organizationMemberships', async () => {
    const rows = await db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, userId));
    // Enrich with org name/slug (read-only, no admin data)
    const enriched = await Promise.all(rows.map(async (m: typeof organizationMemberships.$inferSelect) => {
      const orgRows = await db.select().from(organizations).where(eq(organizations.id, m.organizationId));
      const org = orgRows[0];
      return {
        id: m.id,
        organization: org ? {
          name: org.name,
          slug: org.slug,
        } : null,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      };
    }));
    return enriched;
  }, errors);

  // ── Education roles (only this user's role, never classmates/teachers) ──
  const educationRoleRows = await safeCollect('educationRoleAssignments', async () => {
    const rows = await db
      .select()
      .from(educationRoleAssignments)
      .where(eq(educationRoleAssignments.userId, userId));

    return await Promise.all(rows.map(async (role: typeof educationRoleAssignments.$inferSelect) => {
      const orgRows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, role.organizationId));
      const org = orgRows[0];
      return {
        id: role.id,
        organization: org ? { name: org.name, slug: org.slug } : null,
        role: role.role,
        status: role.status,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      };
    }));
  }, errors);

  // ── Career development data (strictly scoped to this user) ──
  const careerProfileRows = await safeCollect('careerProfiles', async () => {
    return await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId));
  }, errors);

  const careerAbilityRows = await safeCollect('careerAbilities', async () => {
    return await db.select().from(careerAbilities).where(eq(careerAbilities.userId, userId));
  }, errors);

  const careerEvidenceRows = await safeCollect('careerEvidence', async () => {
    const rows = await db.select().from(careerEvidence).where(eq(careerEvidence.userId, userId));
    return rows.map((row: typeof careerEvidence.$inferSelect) => (
      stripOtherUserReferences(row, ['reviewedBy'])
    ));
  }, errors);

  const careerGoalRows = await safeCollect('careerGoals', async () => {
    const rows = await db.select().from(careerGoals).where(eq(careerGoals.userId, userId));
    return rows.map((row: typeof careerGoals.$inferSelect) => (
      stripOtherUserReferences(row, ['confirmedBy'])
    ));
  }, errors);

  const careerTaskRows = await safeCollect('careerTasks', async () => {
    const rows = await db.select().from(careerTasks).where(eq(careerTasks.userId, userId));
    return rows.map((row: typeof careerTasks.$inferSelect) => (
      stripOtherUserReferences(row, ['assignedBy'])
    ));
  }, errors);

  const careerSnapshotRows = await safeCollect('careerProfileSnapshots', async () => {
    return await db
      .select()
      .from(careerProfileSnapshots)
      .where(eq(careerProfileSnapshots.userId, userId));
  }, errors);

  const careerGuidanceRows = await safeCollect('careerGuidanceNotes', async () => {
    const rows = await db
      .select()
      .from(careerGuidanceNotes)
      .where(and(
        eq(careerGuidanceNotes.userId, userId),
        eq(careerGuidanceNotes.visibility, 'student'),
      ));
    return rows.map((row: typeof careerGuidanceNotes.$inferSelect) => (
      stripOtherUserReferences(row, ['teacherId'])
    ));
  }, errors);

  const careerMatchRows = await safeCollect('careerMatches', async () => {
    return await db.select().from(careerMatches).where(eq(careerMatches.userId, userId));
  }, errors);

  // ── Legal consents ──
  const consentRows = await safeCollect('legalConsents', async () => {
    return await db.select().from(legalConsents).where(eq(legalConsents.userId, userId));
  }, errors);

  // ── AI operations (metadata only, no sensitive data) ──
  const aiOpRows = await safeCollect('aiOperations', async () => {
    return await db.select().from(aiOperations).where(eq(aiOperations.actorId, userId));
  }, errors);

  // ── Support tickets (owned by this user; strip internal admin identity) ──
  const supportTicketRows = await safeCollect('supportTickets', async () => {
    const rows = await db.select().from(supportTickets).where(eq(supportTickets.userId, userId));
    return rows.map((row: typeof supportTickets.$inferSelect) => (
      stripOtherUserReferences(row, ['repliedByUserId'])
    ));
  }, errors);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt,
    user: userProfile,
    settings,
    authAccounts: authAccountRows as UserDataExport['authAccounts'],
    resumes: (resumeRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    resumeSections: (sectionRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    shares: (shareRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    chatSessions: (chatSessionRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    chatMessages: (chatMessageRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    jdAnalyses: (jdRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    grammarChecks: (grammarRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    interviewSessions: (interviewSessionRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    interviewRounds: (interviewRoundRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    interviewMessages: (interviewMessageRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    interviewReports: (interviewReportRows as Array<Record<string, unknown>>).map(r => ({ ...r })),
    creditAccounts: (creditAccountRows as Array<typeof creditAccounts.$inferSelect>)
      .filter(a => a.ownerId === userId)
      .map(a => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
    creditTransactions: (creditTransactionRows as Array<typeof creditTransactions.$inferSelect>)
      .map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
    organizationMemberships: membershipRows as UserDataExport['organizationMemberships'],
    educationRoleAssignments: educationRoleRows as UserDataExport['educationRoleAssignments'],
    careerProfiles: careerProfileRows as UserDataExport['careerProfiles'],
    careerAbilities: careerAbilityRows as UserDataExport['careerAbilities'],
    careerEvidence: careerEvidenceRows as UserDataExport['careerEvidence'],
    careerGoals: careerGoalRows as UserDataExport['careerGoals'],
    careerTasks: careerTaskRows as UserDataExport['careerTasks'],
    careerProfileSnapshots: careerSnapshotRows as UserDataExport['careerProfileSnapshots'],
    careerGuidanceNotes: careerGuidanceRows as UserDataExport['careerGuidanceNotes'],
    careerMatches: careerMatchRows as UserDataExport['careerMatches'],
    legalConsents: (consentRows as Array<typeof legalConsents.$inferSelect>)
      .map(c => ({
        ...c,
        effectiveDate: c.effectiveDate.toISOString(),
        createdAt: c.createdAt.toISOString(),
      })),
    aiOperations: (aiOpRows as Array<typeof aiOperations.$inferSelect>)
      .map(op => ({
        ...op,
        createdAt: op.createdAt.toISOString(),
        updatedAt: op.updatedAt.toISOString(),
      })),
    supportTickets: supportTicketRows as UserDataExport['supportTickets'],
    errors,
  };
}
