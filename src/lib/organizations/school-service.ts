import 'server-only';

import { createHash, randomBytes } from 'crypto';
import { and, count, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  educationRoleAssignments,
  emailOtps,
  organizationDiscounts,
  organizationDomains,
  organizationInvites,
  organizationMemberships,
  organizations,
} from '@/lib/db/schema';
import { generateNumericCode, hashCode, isValidEmail } from '@/lib/auth/email-otp';
import { getMailAdapter } from '@/lib/auth/mail-adapter';
import { checkRateLimit, RATE_LIMIT_POLICIES, rateLimitKey } from '@/lib/rate-limit/rate-limit';
import { config } from '@/lib/config';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export class SchoolError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'SchoolError';
  }
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, '');
}

function inviteHash(value: string) {
  return createHash('sha256').update(value.trim().toUpperCase()).digest('hex');
}

async function bindStudent(executor: typeof db, organizationId: string, userId: string) {
  const [org] = await executor.select().from(organizations).where(and(
    eq(organizations.id, organizationId), eq(organizations.kind, 'school'), eq(organizations.status, 'active'),
  )).limit(1);
  if (!org) throw new SchoolError('SCHOOL_NOT_AVAILABLE');

  const [existing] = await executor.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId),
  )).limit(1);
  const alreadyActive = existing?.status === 'active';
  if (existing?.status !== 'active') {
    const [used] = await executor.select({ value: count() }).from(organizationMemberships).where(and(
      eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, 'active'),
    ));
    if (org.seatLimit > 0 && Number(used?.value ?? 0) >= org.seatLimit) throw new SchoolError('SEAT_LIMIT_EXCEEDED');
  }

  await executor.insert(organizationMemberships).values({
    id: existing?.id ?? crypto.randomUUID(), organizationId, userId, role: 'member', status: 'active', updatedAt: new Date(),
  } as never).onConflictDoUpdate({
    target: [organizationMemberships.organizationId, organizationMemberships.userId],
    set: { status: 'active', role: 'member', updatedAt: new Date() },
  });
  await executor.insert(educationRoleAssignments).values({
    id: crypto.randomUUID(), organizationId, userId, role: 'student', status: 'active', updatedAt: new Date(),
  } as never).onConflictDoUpdate({
    target: [educationRoleAssignments.organizationId, educationRoleAssignments.userId, educationRoleAssignments.role],
    set: { status: 'active', updatedAt: new Date() },
  });
  return { org, alreadyActive };
}

function usesSynchronousSQLiteTransactions(database: typeof db) {
  return config.db.type === 'sqlite' || database.session?.constructor?.name === 'BetterSQLiteSession';
}

function bindStudentSync(executor: typeof db, organizationId: string, userId: string) {
  const org = executor.select().from(organizations).where(and(
    eq(organizations.id, organizationId), eq(organizations.kind, 'school'), eq(organizations.status, 'active'),
  )).limit(1).get() as typeof organizations.$inferSelect | undefined;
  if (!org) throw new SchoolError('SCHOOL_NOT_AVAILABLE');
  const existing = executor.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId),
  )).limit(1).get() as typeof organizationMemberships.$inferSelect | undefined;
  const alreadyActive = existing?.status === 'active';
  if (!alreadyActive) {
    const used = executor.select({ value: count() }).from(organizationMemberships).where(and(
      eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.status, 'active'),
    )).get() as { value: number } | undefined;
    if (org.seatLimit > 0 && Number(used?.value ?? 0) >= org.seatLimit) throw new SchoolError('SEAT_LIMIT_EXCEEDED');
  }
  executor.insert(organizationMemberships).values({
    id: existing?.id ?? crypto.randomUUID(), organizationId, userId, role: 'member', status: 'active', updatedAt: new Date(),
  } as never).onConflictDoUpdate({
    target: [organizationMemberships.organizationId, organizationMemberships.userId],
    set: { status: 'active', role: 'member', updatedAt: new Date() },
  }).run();
  executor.insert(educationRoleAssignments).values({
    id: crypto.randomUUID(), organizationId, userId, role: 'student', status: 'active', updatedAt: new Date(),
  } as never).onConflictDoUpdate({
    target: [educationRoleAssignments.organizationId, educationRoleAssignments.userId, educationRoleAssignments.role],
    set: { status: 'active', updatedAt: new Date() },
  }).run();
  return { org, alreadyActive };
}

export async function getSchoolMembership(userId: string) {
  const [row] = await db.select({
    organizationId: organizations.id,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
    joinedAt: organizationMemberships.createdAt,
  }).from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(educationRoleAssignments, and(
      eq(educationRoleAssignments.organizationId, organizationMemberships.organizationId),
      eq(educationRoleAssignments.userId, organizationMemberships.userId),
    ))
    .where(and(
      eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, 'active'),
      eq(organizations.kind, 'school'), eq(organizations.status, 'active'),
      eq(educationRoleAssignments.role, 'student'), eq(educationRoleAssignments.status, 'active'),
    )).limit(1);
  return row ?? null;
}

export async function redeemSchoolInvite(userId: string, plaintextCode: string) {
  const hash = inviteHash(plaintextCode);
  if (usesSynchronousSQLiteTransactions(db)) {
    db.transaction((tx: typeof db) => {
      const invite = tx.select().from(organizationInvites).where(and(
        eq(organizationInvites.codeHash, hash), eq(organizationInvites.active, true),
        or(isNull(organizationInvites.expiresAt), gt(organizationInvites.expiresAt, new Date())),
        or(isNull(organizationInvites.maxUses), lt(organizationInvites.useCount, organizationInvites.maxUses)),
      )).limit(1).get() as typeof organizationInvites.$inferSelect | undefined;
      if (!invite) throw new SchoolError('INVITE_INVALID_OR_EXPIRED');
      const binding = bindStudentSync(tx, invite.organizationId, userId);
      if (!binding.alreadyActive) {
        const update = tx.update(organizationInvites).set({ useCount: sql`${organizationInvites.useCount} + 1` }).where(and(
          eq(organizationInvites.id, invite.id), eq(organizationInvites.active, true),
          or(isNull(organizationInvites.maxUses), lt(organizationInvites.useCount, organizationInvites.maxUses)),
        )).run();
        if (!update.changes) throw new SchoolError('INVITE_INVALID_OR_EXPIRED');
      }
    });
    return getSchoolMembership(userId);
  }
  await db.transaction(async (tx: typeof db) => {
    const [invite] = await tx.select().from(organizationInvites).where(and(
      eq(organizationInvites.codeHash, hash), eq(organizationInvites.active, true),
      or(isNull(organizationInvites.expiresAt), gt(organizationInvites.expiresAt, new Date())),
      or(isNull(organizationInvites.maxUses), lt(organizationInvites.useCount, organizationInvites.maxUses)),
    )).limit(1);
    if (!invite) throw new SchoolError('INVITE_INVALID_OR_EXPIRED');
    const binding = await bindStudent(tx, invite.organizationId, userId);
    const updated = binding.alreadyActive ? [{ id: invite.id }] : await tx.update(organizationInvites).set({ useCount: sql`${organizationInvites.useCount} + 1` })
      .where(and(
        eq(organizationInvites.id, invite.id), eq(organizationInvites.active, true),
        or(isNull(organizationInvites.maxUses), lt(organizationInvites.useCount, organizationInvites.maxUses)),
      )).returning({ id: organizationInvites.id });
    if (!updated.length) throw new SchoolError('INVITE_INVALID_OR_EXPIRED');
  });
  return getSchoolMembership(userId);
}

export async function requestSchoolEmailVerification(userId: string, email: string, ipAddress?: string | null) {
  if (!isValidEmail(email)) throw new SchoolError('INVALID_EMAIL');
  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizeDomain(normalizedEmail.split('@')[1] ?? '');
  const [schoolDomain] = await db.select().from(organizationDomains)
    .innerJoin(organizations, eq(organizations.id, organizationDomains.organizationId))
    .where(and(
      eq(organizationDomains.domain, domain), eq(organizationDomains.verified, true),
      eq(organizations.kind, 'school'), eq(organizations.status, 'active'),
    )).limit(1);
  if (!schoolDomain) throw new SchoolError('SCHOOL_DOMAIN_NOT_VERIFIED');
  const dimensions = [
    ipAddress ? [rateLimitKey('school-otp', 'ip', ipAddress), RATE_LIMIT_POLICIES.otpRequestIP] as const : null,
    [rateLimitKey('school-otp', 'email', normalizedEmail), RATE_LIMIT_POLICIES.otpRequestEmail] as const,
  ].filter(Boolean) as Array<readonly [string, typeof RATE_LIMIT_POLICIES.otpRequestEmail]>;
  for (const [key, policy] of dimensions) {
    if (!(await checkRateLimit(key, policy)).allowed) throw new SchoolError('RATE_LIMITED');
  }
  const code = generateNumericCode(6);
  await db.insert(emailOtps).values({
    email: normalizedEmail, purpose: 'school_verify', codeHash: hashCode(code), ipAddress: ipAddress ?? null,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await getMailAdapter().sendOTP(normalizedEmail, code, 'school_verify');
  return { email: normalizedEmail, userId };
}

export async function verifySchoolEmailAndBind(userId: string, email: string, code: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [record] = await db.select().from(emailOtps).where(and(
    eq(emailOtps.email, normalizedEmail), eq(emailOtps.purpose, 'school_verify'),
    isNull(emailOtps.usedAt), gt(emailOtps.expiresAt, new Date()),
  )).orderBy(desc(emailOtps.createdAt)).limit(1);
  if (!record || record.attempts >= OTP_MAX_ATTEMPTS) throw new SchoolError('INVALID_CODE');
  if (hashCode(code) !== record.codeHash) {
    await db.update(emailOtps).set({ attempts: record.attempts + 1 }).where(eq(emailOtps.id, record.id));
    throw new SchoolError('INVALID_CODE');
  }
  const domain = normalizeDomain(normalizedEmail.split('@')[1] ?? '');
  const [domainRow] = await db.select().from(organizationDomains).where(and(
    eq(organizationDomains.domain, domain), eq(organizationDomains.verified, true),
  )).limit(1);
  if (!domainRow) throw new SchoolError('SCHOOL_DOMAIN_NOT_VERIFIED');
  if (usesSynchronousSQLiteTransactions(db)) {
    db.transaction((tx: typeof db) => {
      bindStudentSync(tx, domainRow.organizationId, userId);
      tx.update(emailOtps).set({ usedAt: new Date() }).where(eq(emailOtps.id, record.id)).run();
    });
  } else {
    await db.transaction(async (tx: typeof db) => {
      await bindStudent(tx, domainRow.organizationId, userId);
      await tx.update(emailOtps).set({ usedAt: new Date() }).where(eq(emailOtps.id, record.id));
    });
  }
  return getSchoolMembership(userId);
}

export async function getSchoolSettings(organizationId: string) {
  const [org, domains, invites, discounts] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select().from(organizationDomains).where(eq(organizationDomains.organizationId, organizationId)).orderBy(organizationDomains.domain),
    db.select().from(organizationInvites).where(eq(organizationInvites.organizationId, organizationId)).orderBy(desc(organizationInvites.createdAt)),
    db.select().from(organizationDiscounts).where(eq(organizationDiscounts.organizationId, organizationId)).orderBy(organizationDiscounts.planCode),
  ]);
  if (!org[0] || org[0].kind !== 'school') throw new SchoolError('NOT_A_SCHOOL');
  return { organization: org[0], domains, invites, discounts };
}

export async function addSchoolDomain(organizationId: string, adminId: string, domainValue: string) {
  const domain = normalizeDomain(domainValue);
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new SchoolError('INVALID_DOMAIN');
  await db.insert(organizationDomains).values({ id: crypto.randomUUID(), organizationId, domain, verified: false, createdBy: adminId } as never);
  return getSchoolSettings(organizationId);
}

export async function createSchoolInvite(organizationId: string, adminId: string, options: { maxUses?: number; expiresAt?: string | null }) {
  const code = `CP-${randomBytes(9).toString('base64url').toUpperCase()}`;
  const expiresAt = options.expiresAt ? new Date(options.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new SchoolError('INVALID_EXPIRY');
  const maxUses = options.maxUses ?? null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000)) throw new SchoolError('INVALID_MAX_USES');
  await db.insert(organizationInvites).values({
    id: crypto.randomUUID(), organizationId, codeHash: inviteHash(code), codePrefix: code.slice(0, 8),
    maxUses, expiresAt, createdBy: adminId,
  } as never);
  return { ...(await getSchoolSettings(organizationId)), plaintextCode: code };
}

export async function upsertSchoolDiscount(organizationId: string, adminId: string, planCode: string, percentOff: number) {
  const normalizedCode = planCode.trim() || '*';
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 90) throw new SchoolError('INVALID_DISCOUNT');
  await db.insert(organizationDiscounts).values({
    id: crypto.randomUUID(), organizationId, planCode: normalizedCode, percentOff, active: true, createdBy: adminId,
  } as never).onConflictDoUpdate({
    target: [organizationDiscounts.organizationId, organizationDiscounts.planCode],
    set: { percentOff, active: true, updatedAt: new Date() },
  });
  return getSchoolSettings(organizationId);
}

export async function deactivateSchoolSetting(organizationId: string, resource: 'invite' | 'discount' | 'domain', id: string) {
  if (resource === 'invite') await db.update(organizationInvites).set({ active: false }).where(and(eq(organizationInvites.id, id), eq(organizationInvites.organizationId, organizationId)));
  if (resource === 'discount') await db.update(organizationDiscounts).set({ active: false, updatedAt: new Date() }).where(and(eq(organizationDiscounts.id, id), eq(organizationDiscounts.organizationId, organizationId)));
  if (resource === 'domain') await db.delete(organizationDomains).where(and(eq(organizationDomains.id, id), eq(organizationDomains.organizationId, organizationId)));
  return getSchoolSettings(organizationId);
}

export async function verifySchoolDomain(organizationId: string, domainId: string) {
  await db.update(organizationDomains).set({ verified: true }).where(and(
    eq(organizationDomains.id, domainId), eq(organizationDomains.organizationId, organizationId),
  ));
  return getSchoolSettings(organizationId);
}

export async function getSchoolDiscount(userId: string, planCode: string) {
  const membership = await getSchoolMembership(userId);
  if (!membership) return null;
  const now = new Date();
  const rows: Array<typeof organizationDiscounts.$inferSelect> = await db.select().from(organizationDiscounts).where(and(
    eq(organizationDiscounts.organizationId, membership.organizationId), eq(organizationDiscounts.active, true),
    or(eq(organizationDiscounts.planCode, planCode), eq(organizationDiscounts.planCode, '*')),
    or(isNull(organizationDiscounts.startsAt), lte(organizationDiscounts.startsAt, now)),
    or(isNull(organizationDiscounts.endsAt), gt(organizationDiscounts.endsAt, now)),
  ));
  return rows.sort((a, b) => Number(b.planCode === planCode) - Number(a.planCode === planCode))[0] ?? null;
}
