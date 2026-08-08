/**
 * Unified AI Gateway (US-037)
 *
 * Single entry point for all server-side AI calls. Orchestrates the full
 * pipeline: authorization → rate limit → credit hold → provider call → settlement.
 *
 * Design principles:
 * - AC1: Accepts only modelId + business input; no client key/provider/baseUrl
 * - AC2: Pipeline order: auth → status → ownership → model auth → rate limit → hold → call → settle
 * - AC3: Each request creates a unique operation + at least one provider attempt
 * - AC4: Success response contains business result only — no platform keys or metadata
 * - AC5: Zero provider calls on rejection paths (auth, balance, rate limit, model)
 */

import { db } from '@/lib/db';
import { aiOperations, aiProviderAttempts, aiProviders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveProviderCredential } from '@/lib/crypto/credential-crypto';
import { authorizeAiRequest, type ModelCapability } from '@/lib/ai/ai-authorization';
import { createHold, settleHold, releaseHold } from '@/lib/ai/credit-hold-service';
import { checkRateLimit, RATE_LIMIT_POLICIES, rateLimitKey } from '@/lib/rate-limit/rate-limit';
import type { RequestContext } from '@/lib/auth/context';

// ── Types ──

export interface GatewayParams<T> {
  /** Resolved request context (from resolveActiveContext). */
  context: RequestContext;
  /** Catalog model ID (from admin-managed catalog). */
  modelId: string;
  /** Requested capability. */
  capability: ModelCapability;
  /** Business capability label for the operation (e.g. 'chat', 'cover_letter'). */
  businessCapability: string;
  /** Idempotency key for the operation (unique per business request). */
  idempotencyKey: string;
  /** The dispatch function that performs the actual AI call. */
  dispatch: (ctx: GatewayDispatchContext) => Promise<T>;
}

export interface GatewayDispatchContext {
  /** The model identifier to pass to the AI SDK (e.g. 'gpt-4'). */
  modelIdentifier: string;
  /** The provider type (e.g. 'openai', 'anthropic', 'gemini'). */
  providerType: string;
  /** Decrypted API key — short-lived, do not persist. */
  apiKey: string;
  /** Base URL for the provider (null = use SDK default). */
  baseUrl: string | null;
}

export interface GatewayResult<T> {
  ok: true;
  data: T;
  operationId: string;
  attemptId: string;
}

export interface GatewayReject {
  ok: false;
  status: number;
  error: string;
  message: string;
}

export type GatewayResponse<T> = GatewayResult<T> | GatewayReject;

// ── Error → HTTP mapping ──

function rejectFromAuthError(error: string): GatewayReject {
  const map: Record<string, { status: number; message: string }> = {
    'AMBIGUOUS_BILLING': { status: 400, message: 'Ambiguous billing context. Please specify an organization.' },
    'ACCOUNT_FROZEN': { status: 403, message: 'Account is frozen.' },
    'MODEL_NOT_ALLOWED': { status: 403, message: 'Model not available.' },
    'CAPABILITY_NOT_SUPPORTED': { status: 400, message: 'Model does not support the requested capability.' },
  };
  const mapped = map[error] ?? { status: 500, message: 'Authorization failed.' };
  return { ok: false, status: mapped.status, error, message: mapped.message };
}

// ── Main gateway function ──

/**
 * Execute a single AI operation through the unified gateway.
 *
 * Pipeline (AC2):
 * 1. Authorization (US-035): resolve billing account + validate model
 * 2. Rate limiting (US-022): per-user check
 * 3. Credit hold (US-036): pre-reserve credits
 * 4. Provider call: dispatch with managed credentials
 * 5. Settlement (US-036): settle based on result
 *
 * On any rejection, NO provider call is made (AC5).
 */
export async function executeAiOperation<T>(
  params: GatewayParams<T>,
): Promise<GatewayResponse<T>> {
  const { context, modelId, capability, businessCapability, idempotencyKey, dispatch } = params;

  // ── Step 1: Authorization ──
  const authResult = await authorizeAiRequest({ context, modelId, capability });
  if (!authResult.ok) {
    return rejectFromAuthError(authResult.error);
  }
  const { account, model } = authResult.data;

  // ── Step 2: Rate limiting ──
  const rateKey = rateLimitKey('ai-gateway', 'user', context.actor.userId);
  const rateLimit = await checkRateLimit(rateKey, RATE_LIMIT_POLICIES.aiChat);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'RATE_LIMITED',
      message: 'Too many AI requests. Please try again later.',
    };
  }

  // ── Step 3: Create operation record ──
  const operationId = crypto.randomUUID();
  try {
    await db.insert(aiOperations).values({
      id: operationId,
      actorId: context.actor.userId,
      billingAccountId: account.id,
      capability: businessCapability,
      status: 'in_progress',
      idempotencyKey,
    });
  } catch {
    // Unique constraint violation — duplicate idempotency key
    return {
      ok: false,
      status: 409,
      error: 'OPERATION_EXISTS',
      message: 'An operation with this idempotency key already exists.',
    };
  }

  // ── Step 4: Create credit hold ──
  let holdResult: { hold: { id: string }; transactionId: string };
  try {
    holdResult = await createHold({
      accountId: account.id,
      operationId,
      model,
      actorId: context.actor.userId,
      idempotencyKey: `hold-${idempotencyKey}`,
    });
  } catch (err) {
    // Insufficient credits — mark operation as failed, no provider call
    await db.update(aiOperations)
      .set({ status: 'failed' })
      .where(eq(aiOperations.id, operationId));

    const error = err as Error;
    const isInsufficient = error.message.includes('Insufficient credits') || error.name === 'InsufficientCreditsError';
    return {
      ok: false,
      status: 422,
      error: isInsufficient ? 'INSUFFICIENT_CREDITS' : 'HOLD_FAILED',
      message: isInsufficient
        ? `${context.billing.accountOwnerType === 'user' ? 'Personal' : 'Organization'} account has insufficient credits.`
        : 'Failed to reserve credits.',
    };
  }

  // ── Step 5: Resolve provider credentials ──
  let apiKey: string;
  let baseUrl: string | null = null;
  let providerType: string;

  try {
    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, model.providerId))
      .limit(1);

    if (provider.length === 0) {
      throw new Error('Provider not found');
    }

    providerType = provider[0].type;
    baseUrl = provider[0].baseUrl;
    apiKey = resolveProviderCredential(model.providerId);
  } catch {
    // Release hold on credential resolution failure
    await releaseHold({ holdId: holdResult.hold.id, reason: 'provider_failure' });
    await db.update(aiOperations)
      .set({ status: 'failed' })
      .where(eq(aiOperations.id, operationId));

    return {
      ok: false,
      status: 503,
      error: 'PROVIDER_CONFIG_ERROR',
      message: 'Provider configuration error. Please contact support.',
    };
  }

  // ── Step 6: Create provider attempt record ──
  const attemptId = crypto.randomUUID();
  const startTime = Date.now();
  await db.insert(aiProviderAttempts).values({
    id: attemptId,
    operationId,
    modelId: model.id,
    attemptNumber: 1,
    status: 'in_progress',
  });

  // ── Step 7: Execute dispatch ──
  try {
    const result = await dispatch({
      modelIdentifier: model.modelIdentifier,
      providerType,
      apiKey,
      baseUrl,
    });

    const durationMs = Date.now() - startTime;

    // Mark attempt as succeeded
    await db.update(aiProviderAttempts)
      .set({
        status: 'succeeded',
        durationMs,
        completedAt: new Date(),
        usage: extractUsage(result),
      })
      .where(eq(aiProviderAttempts.id, attemptId));

    // Settle the hold — actual cost from usage
    await settleHold({
      holdId: holdResult.hold.id,
      actualUsage: extractUsageMetrics(result),
    });

    // Mark operation as succeeded
    await db.update(aiOperations)
      .set({ status: 'succeeded' })
      .where(eq(aiOperations.id, operationId));

    return {
      ok: true,
      data: result,
      operationId,
      attemptId,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Mark attempt as failed
    await db.update(aiProviderAttempts)
      .set({
        status: 'failed',
        durationMs,
        completedAt: new Date(),
        errorMessage: sanitizeErrorMessage(errorMessage),
      })
      .where(eq(aiProviderAttempts.id, attemptId));

    // Release the hold
    await releaseHold({ holdId: holdResult.hold.id, reason: 'provider_failure' });

    // Mark operation as failed
    await db.update(aiOperations)
      .set({ status: 'failed' })
      .where(eq(aiOperations.id, operationId));

    return {
      ok: false,
      status: 502,
      error: 'PROVIDER_ERROR',
      message: 'AI provider call failed.',
    };
  }
}

// ── Helpers ──

/**
 * Extract usage metrics from a dispatch result.
 * The result type varies by SDK function (generateText, streamText, etc.).
 * We try to read common fields if available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUsage(result: any): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const usage = result.usage ?? result.totalUsage;
  if (!usage) return {};
  return {
    inputTokens: usage.promptTokens ?? usage.inputTokens ?? null,
    outputTokens: usage.completionTokens ?? usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
}

function extractUsageMetrics(result: unknown): { inputTokens?: number; outputTokens?: number; totalTokens?: number } {
  const usage = extractUsage(result);
  return {
    inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
    outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
    totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
  };
}

/**
 * Sanitize error messages to prevent leaking internal details.
 * Removes URLs, API keys, and internal paths.
 */
function sanitizeErrorMessage(message: string): string {
  // Remove anything that looks like a URL
  let sanitized = message.replace(/https?:\/\/[^\s]+/g, '[url]');
  // Remove anything that looks like an API key
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]+/g, '[key]');
  sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]+/g, '[key]');
  // Truncate
  if (sanitized.length > 200) sanitized = sanitized.substring(0, 200) + '...';
  return sanitized;
}
