import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { reconcileStripe } from '@/lib/billing/service';

export async function POST() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  if (ctx.context.actor.platformRole !== 'super_admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    return NextResponse.json(await reconcileStripe(ctx.context.actor.userId));
  } catch (error) {
    console.error('[Billing] Reconciliation failed', error);
    return NextResponse.json({ error: 'RECONCILIATION_FAILED' }, { status: 502 });
  }
}
