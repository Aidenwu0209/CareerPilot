import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActiveContext } from '@/lib/auth/guards';
import { BillingError, requestRefund } from '@/lib/billing/service';
import { CreditError } from '@/lib/credits/ledger';

const schema = z.object({
  orderId: z.string().min(1),
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try {
    const result = await requestRefund({ userId: ctx.context.actor.userId, ...parsed.data });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BillingError || error instanceof CreditError) {
      return NextResponse.json({ error: error.code }, { status: error.code === 'ORDER_NOT_FOUND' ? 404 : 409 });
    }
    console.error('[Billing] Refund failed', error);
    return NextResponse.json({ error: 'REFUND_FAILED' }, { status: 502 });
  }
}
