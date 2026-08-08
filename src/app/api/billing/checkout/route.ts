import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActiveContext } from '@/lib/auth/guards';
import { BillingError, createCheckout } from '@/lib/billing/service';

const schema = z.object({
  planId: z.string().min(1),
  locale: z.enum(['zh', 'en']).default('zh'),
});

export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  const clientKey = request.headers.get('idempotency-key')?.trim();
  if (!clientKey || clientKey.length > 128) {
    return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }
  const configuredOrigin = process.env.APP_URL?.replace(/\/$/, '');
  const origin = configuredOrigin || new URL(request.url).origin;
  try {
    const result = await createCheckout({
      userId: ctx.context.actor.userId,
      planId: parsed.data.planId,
      idempotencyKey: clientKey,
      origin,
      locale: parsed.data.locale,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BillingError) return NextResponse.json({ error: error.code }, { status: 400 });
    console.error('[Billing] Checkout failed', error);
    return NextResponse.json({ error: 'CHECKOUT_FAILED' }, { status: 502 });
  }
}
