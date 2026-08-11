import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { listUserOrders } from '@/lib/billing/service';

export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  return NextResponse.json({ orders: await listUserOrders(ctx.context.actor.userId) });
}
