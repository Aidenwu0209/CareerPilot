import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { listActivePlans } from '@/lib/billing/service';
import { billingPlans } from '@/lib/db/schema';

export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const plans = await listActivePlans(ctx.context.actor.userId);
  return NextResponse.json({ plans: plans.map((row: typeof billingPlans.$inferSelect & { effectivePriceMinor: number; schoolDiscount: { percentOff: number; organizationId: string } | null }) => ({
    id: row.id, code: row.code, name: row.name, description: row.description,
    kind: row.kind, userLevel: row.userLevel, priceMinor: row.priceMinor,
    currency: row.currency, credits: row.credits, billingInterval: row.billingInterval,
    active: row.active, sortOrder: row.sortOrder,
    effectivePriceMinor: row.effectivePriceMinor, schoolDiscount: row.schoolDiscount,
  })) });
}
