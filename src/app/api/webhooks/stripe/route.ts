import { NextResponse } from 'next/server';
import { constructStripeEvent } from '@/lib/billing/stripe-provider';
import { processStripeEvent } from '@/lib/billing/service';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'SIGNATURE_REQUIRED' }, { status: 400 });
  const payload = await request.text();
  try {
    const event = constructStripeEvent(payload, signature);
    const result = await processStripeEvent(event, payload);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    logger.error('billing.stripe_webhook_failed', { error });
    return NextResponse.json({ error: 'WEBHOOK_REJECTED' }, { status: 400 });
  }
}
