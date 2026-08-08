import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { getOrCreateAccount, creditAccount, debitAccount, CreditError, InsufficientCreditsError } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/admin/users/[id]/adjust
 *
 * Super admin: adjust a user's personal credit balance.
 *
 * Body: { amount: number (non-zero int), reason: string, idempotencyKey: string, note?: string }
 *
 * - AC1: Non-zero integer, mandatory reason + idempotency key
 * - AC2: Debit causing negative → INSUFFICIENT_CREDITS (422)
 * - AC3: Returns new balance + transaction; writes audit event
 * - AC5: Duplicate idempotent request → no duplicate adjustment or audit
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
  let body: { amount?: number; reason?: string; idempotencyKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { amount, reason, idempotencyKey } = body;

  // AC1: Validate amount — non-zero integer
  if (amount === undefined || !Number.isInteger(amount) || amount === 0) {
    return NextResponse.json(
      { error: 'INVALID_AMOUNT', detail: 'amount must be a non-zero integer' },
      { status: 400 },
    );
  }

  // AC1: Mandatory reason
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 });
  }

  // AC1: Mandatory idempotency key
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }

  // Verify target user exists
  const target = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, targetId)).limit(1);
  if (target.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }

  // Get or create the user's personal credit account
  const account = await getOrCreateAccount('user', targetId);

  // AC2/AC3: Perform adjustment via ledger
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

    // AC3: Write audit event (AC5: dedup via requestId)
    await recordAuditEvent({
      actorId: adminId,
      action: 'credit.adjust',
      targetType: 'credit_account',
      targetId,
      requestId: idempotencyKey,
      result: 'success',
      summary: `Adjusted ${amount > 0 ? '+' : ''}${amount} for user ${target[0].email ?? targetId}: ${reason}`,
      idempotent: true,
    });

    return NextResponse.json({
      userId: targetId,
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
    // AC2: Insufficient credits
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_CREDITS', detail: 'Debit would result in negative balance' },
        { status: 422 },
      );
    }
    if (e instanceof CreditError) {
      return NextResponse.json({ error: e.code }, { status: 400 });
    }
    throw e;
  }
}
