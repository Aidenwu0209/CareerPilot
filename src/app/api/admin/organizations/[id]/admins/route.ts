import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { organizations, organizationMemberships, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/admin/organizations/[id]/admins
 *
 * Super admin: appoint a user as org_admin by exact email.
 *
 * Body: { email: string }
 *
 * AC3: Appoint via exact email — user must already be registered
 * AC5: Writes audit event
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id: orgId } = await params;

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

  // Verify org exists
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  // AC3: Find user by exact email
  const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND', detail: `No user with email '${email}'` }, { status: 404 });
  }

  const targetUserId = user[0].id;

  // Check if membership already exists
  const existing = await db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, targetUserId)))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].role === 'org_admin' && existing[0].status === 'active') {
      return NextResponse.json({ error: 'ALREADY_ADMIN', detail: 'User is already an active org_admin' }, { status: 409 });
    }
    // Update existing membership to org_admin + active
    await db.update(organizationMemberships)
      .set({ role: 'org_admin', status: 'active', updatedAt: new Date() })
      .where(eq(organizationMemberships.id, existing[0].id));
  } else {
    // Create new membership
    await db.insert(organizationMemberships).values({
      organizationId: orgId,
      userId: targetUserId,
      role: 'org_admin',
      status: 'active',
    });
  }

  // AC5: Audit event
  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'org.admin.appoint',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Appointed ${email} as org_admin of '${org[0].name}'`,
  });

  return NextResponse.json({
    organizationId: orgId,
    userId: targetUserId,
    email,
    role: 'org_admin',
    status: 'active',
  }, { status: 201 });
}

/**
 * DELETE /api/admin/organizations/[id]/admins
 *
 * Super admin: revoke org_admin role from a user by exact email.
 *
 * Body: { email: string }
 *
 * AC3: Revoke via exact email
 * AC5: Writes audit event
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id: orgId } = await params;

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

  // Verify org exists
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  // Find user by exact email
  const user = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND', detail: `No user with email '${email}'` }, { status: 404 });
  }

  const targetUserId = user[0].id;

  // Find active org_admin membership
  const membership = await db
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, orgId),
      eq(organizationMemberships.userId, targetUserId),
      eq(organizationMemberships.role, 'org_admin'),
    ))
    .limit(1);

  if (membership.length === 0) {
    return NextResponse.json({ error: 'NOT_AN_ADMIN', detail: 'User is not an org_admin of this organization' }, { status: 404 });
  }

  // Revoke: downgrade to member, keep status active (they're still a member, just not admin)
  await db.update(organizationMemberships)
    .set({ role: 'member', updatedAt: new Date() })
    .where(eq(organizationMemberships.id, membership[0].id));

  // AC5: Audit event
  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'org.admin.revoke',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Revoked org_admin from ${email} in '${org[0].name}'`,
  });

  return NextResponse.json({
    organizationId: orgId,
    userId: targetUserId,
    email,
    role: 'member',
    status: 'active',
  });
}
