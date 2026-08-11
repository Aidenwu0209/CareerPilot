import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/admin/users/[id]/freeze
 *
 * Super admin: freeze or unfreeze a user account.
 *
 * Body: { action: 'freeze' | 'unfreeze', idempotencyKey: string }
 *
 * - AC2: non-super-admin → 403
 * - AC3: requires explicit target, idempotency key, and audit event
 * - AC4: after freeze, US-017 status guard blocks next private request
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

  const { id: targetId } = await params;
  const adminId = ctx.context.actor.userId;

  // Parse body
  let body: { action?: string; idempotencyKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const action = body.action;
  const idempotencyKey = body.idempotencyKey;

  if (!action || !['freeze', 'unfreeze'].includes(action)) {
    return NextResponse.json({ error: 'INVALID_ACTION', detail: 'action must be freeze or unfreeze' }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }

  // Verify target exists
  const target = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (target.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }

  const newStatus = action === 'freeze' ? 'suspended' : 'active';
  const currentStatus = target[0].status;

  // Idempotent: if already in the target state, return success without duplicate writes
  if (currentStatus === newStatus) {
    // Still record an audit event for traceability (idempotent dedup will handle duplicates)
    await recordAuditEvent({
      actorId: adminId,
      action: `user.${action}`,
      targetType: 'user',
      targetId: targetId,
      requestId: idempotencyKey,
      result: 'success',
      summary: `User ${target[0].email ?? targetId} already ${newStatus} (idempotent)`,
      idempotent: true,
    });

    return NextResponse.json({
      id: targetId,
      status: newStatus,
      message: `Already ${newStatus}`,
      idempotent: true,
    });
  }

  // Update status
  await db.update(users).set({ status: newStatus, updatedAt: new Date() }).where(eq(users.id, targetId));

  // Record audit event
  const auditId = await recordAuditEvent({
    actorId: adminId,
    action: `user.${action}`,
    targetType: 'user',
    targetId: targetId,
    requestId: idempotencyKey,
    result: 'success',
    summary: `${action === 'freeze' ? 'Froze' : 'Unfroze'} user ${target[0].email ?? targetId}`,
    idempotent: true,
  });

  return NextResponse.json({
    id: targetId,
    status: newStatus,
    action,
    auditEventId: auditId === 'DEDUPED' ? null : auditId,
    idempotent: auditId === 'DEDUPED',
  });
}
