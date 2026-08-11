import Stripe from 'stripe';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentProvider,
  ProviderPaymentSnapshot,
  RefundInput,
  RefundResult,
} from './payment-provider';

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_NOT_CONFIGURED');
  if (!client) client = new Stripe(secret, { maxNetworkRetries: 2 });
  return client;
}

export class StripePaymentProvider implements PaymentProvider {
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const stripe = getStripeClient();
    const metadata = {
      orderId: input.orderId,
      userId: input.userId,
      accountId: input.accountId,
      planId: input.planId,
    };
    const recurring = input.kind === 'subscription';
    const session = await stripe.checkout.sessions.create({
      mode: recurring ? 'subscription' : 'payment',
      client_reference_id: input.orderId,
      customer_email: input.customerEmail || undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      payment_intent_data: recurring ? undefined : { metadata },
      subscription_data: recurring ? { metadata } : undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: input.amountMinor,
          product_data: { name: input.planName, metadata: { planId: input.planId } },
          recurring: recurring ? { interval: input.interval ?? 'month' } : undefined,
        },
      }],
    }, { idempotencyKey: `checkout:${input.orderId}` });
    if (!session.url) throw new Error('STRIPE_CHECKOUT_URL_MISSING');
    return { providerOrderId: session.id, checkoutUrl: session.url };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const refund = await getStripeClient().refunds.create({
      payment_intent: input.paymentId,
      amount: input.amountMinor,
      reason: 'requested_by_customer',
      metadata: { refundId: input.refundId, reason: input.reason },
    }, { idempotencyKey: `refund:${input.refundId}` });
    return {
      providerRefundId: refund.id,
      status: refund.status === 'succeeded' ? 'succeeded'
        : refund.status === 'failed' ? 'failed'
          : refund.status === 'canceled' ? 'canceled' : 'pending',
    };
  }

  async retrievePayment(providerOrderId: string): Promise<ProviderPaymentSnapshot> {
    const session = await getStripeClient().checkout.sessions.retrieve(providerOrderId);
    return {
      providerOrderId: session.id,
      paymentStatus: session.payment_status as ProviderPaymentSnapshot['paymentStatus'],
      amountTotal: session.amount_total ?? 0,
      currency: session.currency ?? '',
      paymentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
    };
  }
}

export function constructStripeEvent(payload: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
  return getStripeClient().webhooks.constructEvent(payload, signature, secret);
}
