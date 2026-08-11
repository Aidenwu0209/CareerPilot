import { NextResponse } from 'next/server';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { organizations, organizationMemberships, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * GET /api/organizations/[orgId]/members
 *
 * Org admin: list members of their organization.
 *
 * AC5: Response excludes resumes, interviews, chat content, platform keys.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;

  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;

  const rows = await db
    .select({
      membershipId: organizationMemberships.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
      joinedAt: organizationMemberships.createdAt,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .where(eq(organizationMemberships.organizationId, orgId))
    .orderBy(organizationMemberships.createdAt);

  // Get seat info
  const org = await db.select({ seatLimit: organizations.seatLimit }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const seatLimit = org[0]?.seatLimit ?? 0;
  const activeCount = rows.filter((r: typeof rows[number]) => r.status === 'active').length;

  return NextResponse.json({
    members: rows,
    seats: { used: activeCount, limit: seatLimit },
  });
}

/**
 * POST /api/organizations/[orgId]/members
 *
 * Org admin: add a registered user as a member by exact email.
 *
 * Body: { email: string }
 *
 * AC1: Add registered user by exact email
 * AC2: Duplicate member, seat limit exceeded, or billing conflict → error
 * AC3: Cannot grant super_admin
 * AC4: After removal, re-add is possible
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;

  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { email } = body;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'EMAIL_REQUIRED' }, { status: 400 });
  }

  // AC1: Find user by exact email
  const user = await db.select({ id: users.id, platformRole: users.platformRole }).from(users).where(eq(users.email, email)).limit(1);
  if (user.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND', detail: `No registered user with email '${email}'` }, { status: 404 });
  }

  const targetUserId = user[0].id;

  // AC3: Cannot add super_admin as member (they can't be org-scoped)
  if (user[0].platformRole === 'super_admin') {
    return NextResponse.json({ error: 'CANNOT_ADD_SUPER_ADMIN' }, { status: 400 });
  }

  // Check existing membership
  const existing = await db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, targetUserId)))
    .limit(1);

  // AC2: Duplicate active member
  if (existing.length > 0 && existing[0].status === 'active') {
    return NextResponse.json({ error: 'ALREADY_MEMBER', detail: 'User is already an active member' }, { status: 409 });
  }

  // AC2: Check seat limit (only new memberships consume a new seat — reactivation reuses the existing one)
  const org = await db.select({ seatLimit: organizations.seatLimit, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const seatLimit = org[0]?.seatLimit ?? 0;

  const isNewSeat = existing.length === 0;
  if (isNewSeat) {
    const activeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.status, 'active')));

    if (activeCount[0].count >= seatLimit) {
      return NextResponse.json({ error: 'SEAT_LIMIT_EXCEEDED', detail: `Organization has reached its seat limit of ${seatLimit}` }, { status: 409 });
    }

    // AC2: Billing conflict — user already has an active membership in another org
    const otherOrgMemberships = await db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.userId, targetUserId),
        eq(organizationMemberships.status, 'active'),
      ));
    if (otherOrgMemberships.length > 0) {
      return NextResponse.json(
        { error: 'BILLING_CONFLICT', detail: 'User already has an active membership in another organization' },
        { status: 409 },
      );
    }
  }

  if (existing.length > 0) {
    // Re-activate previously removed membership
    await db.update(organizationMemberships)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(organizationMemberships.id, existing[0].id));
  } else {
    // Create new membership
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: targetUserId,
      role: 'member',
      status: 'active',
    });
  }

  // Audit event
  await recordAuditEvent({
    actorId: guard.adminId,
    action: 'org.member.add',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Added member ${email} to '${org[0]?.name ?? orgId}'`,
  });

  return NextResponse.json({
    organizationId: orgId,
    userId: targetUserId,
    email,
    role: 'member',
    status: 'active',
  }, { status: 201 });
}
