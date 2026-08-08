/**
 * AI Billing Account & Model Authorization Service (US-035)
 *
 * Resolves the unique billing account and validates model permissions
 * BEFORE any provider calls or credit holds.
 *
 * Design principles:
 * - Billing account is ALWAYS resolved from server-side RequestContext,
 *   never from client-supplied values.
 * - Model must exist, be active, be public, and have the requested capability.
 * - Client-supplied account balance, price, provider, or base URL are
 *   structurally ignored — they are not accepted as parameters.
 * - All rejections happen before credit hold or provider dispatch.
 */

import { RequestContext, AmbiguousBillingError } from '@/lib/auth/context';
import { getOrCreateAccount, type AccountRecord } from '@/lib/credits/ledger';
import { validateModelAccess, type CatalogModel } from '@/lib/ai/model-catalog';

// ── Types ──

export type ModelCapability = 'text' | 'image_generation';

export interface AiAuthorizationParams {
  /** The resolved request context (from resolveActiveContext). */
  context: RequestContext;
  /** The model ID to use (from admin-managed catalog). */
  modelId: string;
  /** The capability being requested (text generation, image generation, etc.). */
  capability: ModelCapability;
}

export interface AuthorizedAiRequest {
  account: AccountRecord;
  model: CatalogModel;
  capability: ModelCapability;
}

// ── Error codes ──

export type AiAuthErrorCode =
  | 'AMBIGUOUS_BILLING'
  | 'ACCOUNT_FROZEN'
  | 'MODEL_NOT_ALLOWED'
  | 'CAPABILITY_NOT_SUPPORTED';

export interface AiAuthError {
  ok: false;
  error: AiAuthErrorCode;
  message: string;
}

export interface AiAuthSuccess {
  ok: true;
  data: AuthorizedAiRequest;
}

export type AiAuthResult = AiAuthSuccess | AiAuthError;

// ── Resolution ──

/**
 * Resolve the billing account and validate model authorization.
 *
 * This is the single entry point for AI operations — it must be called
 * BEFORE any credit hold or upstream provider call.
 *
 * AC1: Personal users → personal credit account; org members → org credit account.
 * AC2: Multi-org conflict, frozen account, disabled org → stable error.
 * AC3: Model must exist, be active, be public, and match the requested capability.
 * AC4: Client-supplied balance, price, provider, or base URL are NOT accepted
 *      as parameters — they are structurally excluded.
 * AC5: All rejections happen here, before any hold or provider call.
 */
export async function authorizeAiRequest(
  params: AiAuthorizationParams,
): Promise<AiAuthResult> {
  const { context, modelId, capability } = params;

  // AC2: Ambiguous billing (multiple active org memberships)
  // resolveContextForUser already throws AmbiguousBillingError, but
  // resolveActiveContext catches it and returns a 400 response.
  // By the time we get here, context is already resolved — but we
  // double-check for safety.
  if (context.tenant.type === 'organization' && !context.tenant.organizationId) {
    return {
      ok: false,
      error: 'AMBIGUOUS_BILLING',
      message: 'Cannot determine billing context: organization ID is missing.',
    };
  }

  // AC1: Resolve the billing account from context.
  // getOrCreateAccount is the ONLY way to get an account — it uses
  // the (ownerType, ownerId) compound unique constraint.
  const account = await getOrCreateAccount(
    context.billing.accountOwnerType,
    context.billing.accountOwnerId,
  );

  // AC2: Check account status
  if (account.status === 'frozen') {
    return {
      ok: false,
      error: 'ACCOUNT_FROZEN',
      message: 'Billing account is frozen. Please contact support.',
    };
  }

  // AC3: Validate model access (exists, active, public, provider active)
  const modelAccess = await validateModelAccess(modelId);
  if (!modelAccess.ok) {
    return {
      ok: false,
      error: 'MODEL_NOT_ALLOWED',
      message: 'The requested model is not available.',
    };
  }

  // AC3: Check capability match
  const capabilities = modelAccess.model.capabilities;
  if (!capabilities.includes(capability)) {
    return {
      ok: false,
      error: 'CAPABILITY_NOT_SUPPORTED',
      message: `Model does not support capability '${capability}'.`,
    };
  }

  // Success — return the authorized request context
  return {
    ok: true,
    data: {
      account,
      model: modelAccess.model,
      capability,
    },
  };
}
