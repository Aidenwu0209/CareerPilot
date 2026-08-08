import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { getOrCreateAccount, creditAccount, debitAccount, CreditError, InsufficientCreditsError } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/admin/organizations/[orgId]/adjust
 *
 * Super admin: adjust an organization's credit balance.
 *
 * Body: { amount: number (non-zero int), reason: string, idempotencyKey: string }
 *
 * AC1: Add/debit with mandatory reason and idempotency key
 * AC2: Cannot go negative — INSUFFICIENT_CREDITS (422)
 * AC5: Cross-org accountId never accepted from client
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { orgId } = await params;
  const adminId = ctx.context.actor.userId;

  // Verify org exists
  const org = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (org.length === 0) {
    return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });
  }

  let body: { amount?: number; reason?: string; idempotencyKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { amount, reason, idempotencyKey } = body;

  if (amount === undefined || !Number.isInteger(amount) || amount === 0) {
    return NextResponse.json({ error: 'INVALID_AMOUNT', detail: 'amount must be a non-zero integer' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }

  const account = await getOrCreateAccount('organization', orgId);

  try {
    let result;
    if (amount > 0) {
      result = creditAccount({
        accountId: account.id,
        amount,
        reason: 'adjustment',
        operatorId: adminId,
        idempotencyKey,
        note: reason,
      });
    } else {
      result = debitAccount({
        accountId: account.id,
        amount: Math.abs(amount),
        reason: 'adjustment',
        operatorId: adminId,
        idempotencyKey,
        note: reason,
      });
    }

    const isIdempotent = result.idempotent;

    await recordAuditEvent({
      actorId: adminId,
      action: 'org.credit.adjust',
      targetType: 'organization',
      targetId: orgId,
      requestId: idempotencyKey,
      result: 'success',
      summary: `Adjusted ${amount > 0 ? '+' : ''}${amount} for org '${org[0].name}': ${reason}`,
      idempotent: true,
    });

    return NextResponse.json({
      organizationId: orgId,
      balance: result.account.balance,
      transaction: isIdempotent ? null : {
        id: result.transaction.id,
        delta: result.transaction.delta,
        balanceAfter: result.transaction.balanceAfter,
        reason: result.transaction.reason,
        note: result.transaction.note,
        createdAt: result.transaction.createdAt,
      },
      action: 'adjust',
      idempotent: isIdempotent,
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: 'INSUFFICIENT_CREDITS' }, { status: 422 });
    }
    if (e instanceof CreditError) {
      return NextResponse.json({ error: e.code }, { status: 400 });
    }
    throw e;
  }
}
