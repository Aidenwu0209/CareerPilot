import type { PaymentProvider } from './payment-provider';
import { StripePaymentProvider } from './stripe-provider';

export type PaymentProviderName = 'stripe';

export function getPaymentProvider(name: PaymentProviderName = 'stripe'): PaymentProvider {
  if (name === 'stripe') return new StripePaymentProvider();
  throw new Error('PAYMENT_PROVIDER_UNSUPPORTED');
}
