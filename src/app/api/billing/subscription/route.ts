import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { BillingError, createCustomerPortal, getUserSubscription } from '@/lib/billing/service';

export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const subscription = await getUserSubscription(ctx.context.actor.userId);
  return NextResponse.json({ subscription });
}

export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const origin = process.env.APP_URL?.replace(/\/$/, '') || new URL(request.url).origin;
  const body = await request.json().catch(() => ({})) as { locale?: string };
  const locale = body.locale === 'en' ? 'en' : 'zh';
  try {
    return NextResponse.json(await createCustomerPortal(ctx.context.actor.userId, `${origin}/${locale}/credits`));
  } catch (error) {
    if (error instanceof BillingError) return NextResponse.json({ error: error.code }, { status: 404 });
    return NextResponse.json({ error: 'PORTAL_FAILED' }, { status: 502 });
  }
}
