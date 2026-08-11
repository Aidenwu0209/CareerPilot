import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { organizations, organizationMemberships, creditAccounts, users } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';

/**
 * GET /api/admin/organizations/[id]
 *
 * Super admin: view org detail with member count, balance, and admins.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;

  const org = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  // Count active members
  const memberCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, id),
        eq(organizationMemberships.status, 'active'),
      ),
    );

  // Fetch balance
  const [balanceRow] = await db
    .select({ balance: creditAccounts.balance })
    .from(creditAccounts)
    .where(
      and(
        eq(creditAccounts.ownerType, 'organization'),
        eq(creditAccounts.ownerId, id),
      ),
    )
    .limit(1);

  // Fetch admins
  const admins = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(organizationMemberships.userId, users.id))
    .where(
      and(
        eq(organizationMemberships.organizationId, id),
        eq(organizationMemberships.role, 'org_admin'),
        eq(organizationMemberships.status, 'active'),
      ),
    );

  return NextResponse.json({
    ...org[0],
    memberCount: memberCount[0]?.count ?? 0,
    balance: balanceRow?.balance ?? 0,
    admins,
  });
}

/**
 * PATCH /api/admin/organizations/[id]
 *
 * Super admin: update organization status/name/seatLimit.
 *
 * Body: { name?, status?, seatLimit? }
 *
 * AC4: Suspending org blocks future org-scoped requests (context resolver filters by active status)
 * AC5: Writes audit event
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;

  let body: { name?: string; status?: string; seatLimit?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  // Verify org exists
  const org = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  const updates: Partial<typeof organizations.$inferInsert> = { updatedAt: new Date() };
  const changes: string[] = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 });
    }
    updates.name = body.name.trim();
    changes.push(`name='${body.name.trim()}'`);
  }

  if (body.status !== undefined) {
    if (!['active', 'suspended'].includes(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
    }
    updates.status = body.status as 'active' | 'suspended';
    changes.push(`status=${body.status}`);
  }

  if (body.seatLimit !== undefined) {
    if (!Number.isInteger(body.seatLimit) || body.seatLimit < 0) {
      return NextResponse.json({ error: 'INVALID_SEAT_LIMIT' }, { status: 400 });
    }
    updates.seatLimit = body.seatLimit;
    changes.push(`seatLimit=${body.seatLimit}`);
  }

  if (changes.length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES', detail: 'At least one field must be provided' }, { status: 400 });
  }

  // Apply update
  await db.update(organizations).set(updates).where(eq(organizations.id, id));

  // AC5: Audit event
  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'org.update',
    targetType: 'organization',
    targetId: id,
    result: 'success',
    summary: `Updated organization '${org[0].name}': ${changes.join(', ')}`,
  });

  const updated = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return NextResponse.json({ organization: updated[0] });
}
