export interface CheckoutInput {
  orderId: string;
  userId: string;
  accountId: string;
  planId: string;
  planName: string;
  kind: 'credit_pack' | 'subscription';
  amountMinor: number;
  currency: string;
  interval: 'month' | 'year' | null;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  providerOrderId: string;
  checkoutUrl: string;
}

export interface RefundInput {
  paymentId: string;
  amountMinor: number;
  refundId: string;
  reason: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'canceled';
}

export interface ProviderPaymentSnapshot {
  providerOrderId: string;
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  amountTotal: number;
  currency: string;
  paymentId: string | null;
}

export interface PaymentProvider {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  retrievePayment(providerOrderId: string): Promise<ProviderPaymentSnapshot>;
}
