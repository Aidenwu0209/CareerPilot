/**
 * Unified AI Gateway (US-037 + US-038)
 *
 * Single entry point for all server-side AI calls. Orchestrates the full
 * pipeline: authorization → rate limit → credit hold → provider call → settlement.
 *
 * US-037: Single-call gateway
 * US-038: Multi-attempt with controlled retry + idempotent replay
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
  /** Max retry attempts on dispatch failure (default: from model.maxSteps or 3). */
  maxRetries?: number;
  /** Whether to cache and replay results for duplicate idempotency keys (default: true). */
  enableReplay?: boolean;
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

  // ── Step 3: Create operation record (or replay existing) ──
  // Check for existing operation with same idempotency key (AC3: idempotent replay)
  const existingOp = await db
    .select()
    .from(aiOperations)
    .where(eq(aiOperations.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingOp.length > 0) {
    const op = existingOp[0];
    if (op.status === 'succeeded' && params.enableReplay !== false) {
      // Return cached result from metadata
      const meta = typeof op.metadata === 'string' ? JSON.parse(op.metadata) : (op.metadata ?? {});
      if (meta.cachedResult !== undefined) {
        return {
          ok: true,
          data: meta.cachedResult as T,
          operationId: op.id,
          attemptId: meta.lastAttemptId ?? '',
        };
      }
    }
    // Operation exists but didn't succeed or no cached result
    return {
      ok: false,
      status: 409,
      error: 'OPERATION_EXISTS',
      message: 'An operation with this idempotency key already exists.',
    };
  }

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

  // ── Step 6: Multi-attempt retry loop (US-038) ──
  const maxRetries = params.maxRetries ?? model.maxSteps ?? 3;
  let lastAttemptId = '';
  let lastError: Error | null = null;

  for (let attemptNum = 1; attemptNum <= maxRetries; attemptNum++) {
    const attemptId = crypto.randomUUID();
    const startTime = Date.now();

    // Create attempt record
    await db.insert(aiProviderAttempts).values({
      id: attemptId,
      operationId,
      modelId: model.id,
      attemptNumber: attemptNum,
      status: 'in_progress',
    });

    try {
      const result = await dispatch({
        modelIdentifier: model.modelIdentifier,
        providerType,
        apiKey,
        baseUrl,
      });

      const durationMs = Date.now() - startTime;

      // Mark attempt as succeeded with usage
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

      // Cache result for idempotent replay (if small enough)
      const cachedResult = tryCacheResult(result);

      // Mark operation as succeeded
      await db.update(aiOperations)
        .set({
          status: 'succeeded',
          metadata: cachedResult !== null
            ? JSON.stringify({ cachedResult, lastAttemptId: attemptId })
            : '{}',
        })
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

      // Mark attempt as failed with sanitized error
      await db.update(aiProviderAttempts)
        .set({
          status: 'failed',
          durationMs,
          completedAt: new Date(),
          errorMessage: sanitizeErrorMessage(errorMessage),
        })
        .where(eq(aiProviderAttempts.id, attemptId));

      lastAttemptId = attemptId;
      lastError = err instanceof Error ? err : new Error(String(err));

      // Continue to next retry attempt (if any remain)
    }
  }

  // All attempts exhausted — release hold and fail operation
  await releaseHold({ holdId: holdResult.hold.id, reason: 'provider_failure' });

  await db.update(aiOperations)
    .set({ status: 'failed' })
    .where(eq(aiOperations.id, operationId));

  return {
    ok: false,
    status: 502,
    error: 'PROVIDER_ERROR',
    message: `AI provider call failed after ${maxRetries} attempts.`,
  };
}

// ── Helpers ──

/** Max size for cached results (10KB serialized). Larger results are not cached. */
const MAX_CACHE_SIZE = 10_000;

/**
 * Try to cache a result for idempotent replay.
 * Returns the result if it's small enough to cache, or null if too large.
 */
function tryCacheResult(result: unknown): unknown {
  try {
    const serialized = JSON.stringify(result);
    if (serialized.length <= MAX_CACHE_SIZE) {
      return JSON.parse(serialized); // Deep clone via parse
    }
  } catch {
    // Non-serializable result — don't cache
  }
  return null;
}

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
 * Removes URLs, API keys, SSNs, emails, tokens, and other sensitive patterns.
 * Truncates aggressively to prevent prompt/resume content from leaking.
 *
 * AC5: Logs must not contain full prompts, resume text, or sensitive values.
 */
function sanitizeErrorMessage(message: string): string {
  // Remove anything that looks like a URL
  let sanitized = message.replace(/https?:\/\/[^\s]+/g, '[url]');
  // Remove anything that looks like an API key
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[key]');
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]+/g, '[key]');
  sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]+/g, '[key]');
  // Remove SSN patterns
  sanitized = sanitized.replace(/\d{3}-\d{2}-\d{4}/g, '[redacted]');
  // Remove email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');
  // Remove Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, '[token]');
  // Redact password/key/secret assignments (e.g., "password is hunter2", "key: abc123")
  sanitized = sanitized.replace(/(password|secret|token|key|credential)\s*(?:is|:)\s*[^\s,;]+/gi, '$1: [redacted]');
  // Redact quoted content that might be prompt/resume text
  sanitized = sanitized.replace(/"[^"]{20,}"/g, '[quoted content]');
  // Truncate to 100 chars — short enough to prevent most prompt content from leaking
  if (sanitized.length > 100) sanitized = sanitized.substring(0, 100) + '...';
  return sanitized;
}

// ── Streaming Gateway (US-039) ──

export interface StreamingDispatchResult {
  /** The readable stream to send to the client. */
  stream: ReadableStream<Uint8Array>;
  /** Called when streaming completes to get final usage. */
  getUsage?: () => Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
}

export interface StreamingGatewayParams {
  context: RequestContext;
  modelId: string;
  capability: ModelCapability;
  businessCapability: string;
  idempotencyKey: string;
  /** Creates the stream (called after hold is secured). */
  dispatch: (ctx: GatewayDispatchContext) => Promise<StreamingDispatchResult>;
  /** Timeout in milliseconds (default: 120000 = 2 min). */
  streamTimeoutMs?: number;
}

export interface StreamingGatewaySuccess {
  ok: true;
  stream: ReadableStream<Uint8Array>;
  operationId: string;
  attemptId: string;
}

export type StreamingGatewayResponse = StreamingGatewaySuccess | GatewayReject;

/**
 * Execute a streaming AI operation through the gateway.
 *
 * AC1: Authorization, rate limit, and credit hold complete BEFORE first byte.
 * AC2: Normal completion settles by usage; failure releases per policy.
 * AC3: Client disconnect, provider error, timeout → distinct operation status.
 * AC4: Expired holds have timeout compensation (from US-036 releaseExpiredHolds).
 * AC5: Duplicate idempotency key returns cached status, no double-charge.
 */
export async function executeStreamingOperation(
  params: StreamingGatewayParams,
): Promise<StreamingGatewayResponse> {
  const { context, modelId, capability, businessCapability, idempotencyKey, dispatch, streamTimeoutMs } = params;

  // ── Pre-flight: Authorization ──
  const authResult = await authorizeAiRequest({ context, modelId, capability });
  if (!authResult.ok) return rejectFromAuthError(authResult.error);
  const { account, model } = authResult.data;

  // ── Pre-flight: Rate limiting ──
  const rateKey = rateLimitKey('ai-gateway', 'user', context.actor.userId);
  const rateLimit = await checkRateLimit(rateKey, RATE_LIMIT_POLICIES.aiChat);
  if (!rateLimit.allowed) {
    return { ok: false, status: 429, error: 'RATE_LIMITED', message: 'Too many AI requests.' };
  }

  // ── Check for existing operation (idempotent replay) ──
  const existingOp = await db
    .select()
    .from(aiOperations)
    .where(eq(aiOperations.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingOp.length > 0) {
    // Streaming results can't be replayed (the stream was already consumed)
    return {
      ok: false,
      status: 409,
      error: 'OPERATION_EXISTS',
      message: 'A streaming operation with this idempotency key already exists.',
    };
  }

  // ── Create operation record ──
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
    return { ok: false, status: 409, error: 'OPERATION_EXISTS', message: 'Operation already exists.' };
  }

  // ── Create credit hold ──
  let holdId: string;
  try {
    const holdResult = await createHold({
      accountId: account.id,
      operationId,
      model,
      actorId: context.actor.userId,
      idempotencyKey: `hold-${idempotencyKey}`,
    });
    holdId = holdResult.hold.id;
  } catch (err) {
    await db.update(aiOperations).set({ status: 'failed' }).where(eq(aiOperations.id, operationId));
    const error = err as Error;
    const isInsufficient = error.message.includes('Insufficient credits') || error.name === 'InsufficientCreditsError';
    return {
      ok: false,
      status: 422,
      error: isInsufficient ? 'INSUFFICIENT_CREDITS' : 'HOLD_FAILED',
      message: isInsufficient ? 'Insufficient credits for this operation.' : 'Failed to reserve credits.',
    };
  }

  // ── Resolve provider credentials ──
  let apiKey: string;
  let baseUrl: string | null = null;
  let providerType: string;

  try {
    const provider = await db.select().from(aiProviders).where(eq(aiProviders.id, model.providerId)).limit(1);
    if (provider.length === 0) throw new Error('Provider not found');
    providerType = provider[0].type;
    baseUrl = provider[0].baseUrl;
    apiKey = resolveProviderCredential(model.providerId);
  } catch {
    await releaseHold({ holdId, reason: 'provider_failure' });
    await db.update(aiOperations).set({ status: 'failed' }).where(eq(aiOperations.id, operationId));
    return { ok: false, status: 503, error: 'PROVIDER_CONFIG_ERROR', message: 'Provider configuration error.' };
  }

  // ── Create attempt record ──
  const attemptId = crypto.randomUUID();
  const startTime = Date.now();
  await db.insert(aiProviderAttempts).values({
    id: attemptId,
    operationId,
    modelId: model.id,
    attemptNumber: 1,
    status: 'in_progress',
  });

  // ── Call dispatch to get the stream ──
  let dispatchResult: StreamingDispatchResult;
  try {
    dispatchResult = await dispatch({ modelIdentifier: model.modelIdentifier, providerType, apiKey, baseUrl });
  } catch {
    // Dispatch creation failed — release hold, mark failure
    await db.update(aiProviderAttempts)
      .set({ status: 'failed', durationMs: Date.now() - startTime, completedAt: new Date(), errorMessage: 'Dispatch creation failed' })
      .where(eq(aiProviderAttempts.id, attemptId));
    await releaseHold({ holdId, reason: 'provider_failure' });
    await db.update(aiOperations).set({ status: 'failed' }).where(eq(aiOperations.id, operationId));
    return { ok: false, status: 502, error: 'PROVIDER_ERROR', message: 'Failed to create stream.' };
  }

  // ── Wrap stream with monitoring ──
  const timeoutMs = streamTimeoutMs ?? 120000;
  const wrappedStream = wrapStreamWithMonitoring({
    originalStream: dispatchResult.stream,
    getUsage: dispatchResult.getUsage,
    holdId,
    operationId,
    attemptId,
    startTime,
    timeoutMs,
  });

  return {
    ok: true,
    stream: wrappedStream,
    operationId,
    attemptId,
  };
}

/**
 * Wrap a ReadableStream with monitoring for completion, errors, and timeout.
 * Handles settlement/release based on stream outcome.
 */
function wrapStreamWithMonitoring(params: {
  originalStream: ReadableStream<Uint8Array>;
  getUsage?: () => Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
  holdId: string;
  operationId: string;
  attemptId: string;
  startTime: number;
  timeoutMs: number;
}): ReadableStream<Uint8Array> {
  const { originalStream, getUsage, holdId, operationId, attemptId, startTime, timeoutMs } = params;

  let settled = false;
  const reader = originalStream.getReader();

  // Set up timeout
  const timeoutHandle = setTimeout(() => {
    handleFailure('timeout', `Stream timed out after ${timeoutMs}ms`);
    reader.cancel('timeout').catch(() => {});
  }, timeoutMs);

  const clearTimer = () => { clearTimeout(timeoutHandle); };

  const handleComplete = async (usage: { totalTokens?: number }) => {
    if (settled) return;
    settled = true;
    clearTimer();

    const durationMs = Date.now() - startTime;
    await db.update(aiProviderAttempts)
      .set({ status: 'succeeded', durationMs, completedAt: new Date(), usage })
      .where(eq(aiProviderAttempts.id, attemptId));

    await settleHold({ holdId, actualUsage: usage });

    await db.update(aiOperations)
      .set({ status: 'succeeded' })
      .where(eq(aiOperations.id, operationId));
  };

  const handleFailure = async (reason: 'client_disconnect' | 'provider_error' | 'timeout', errorMsg?: string) => {
    if (settled) return;
    settled = true;
    clearTimer();

    const durationMs = Date.now() - startTime;
    const attemptStatus = reason === 'timeout' ? 'timeout' : 'failed';

    await db.update(aiProviderAttempts)
      .set({
        status: attemptStatus as 'failed' | 'timeout',
        durationMs,
        completedAt: new Date(),
        errorMessage: sanitizeErrorMessage(errorMsg ?? `Stream ${reason}`),
      })
      .where(eq(aiProviderAttempts.id, attemptId));

    await releaseHold({ holdId, reason: 'provider_failure' });

    await db.update(aiOperations)
      .set({ status: reason === 'client_disconnect' ? 'cancelled' : 'failed' })
      .where(eq(aiOperations.id, operationId));
  };

  // Create monitored stream by manually pumping chunks
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Stream completed normally
          try {
            const usage = getUsage ? await getUsage() : { totalTokens: 0 };
            await handleComplete(usage);
          } catch {
            await handleComplete({ totalTokens: 0 });
          }
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (err) {
        // Provider stream errored
        const msg = err instanceof Error ? err.message : String(err);
        await handleFailure('provider_error', `Provider stream error: ${msg}`);
        controller.error(err);
      }
    },

    cancel(reason) {
      // Client disconnected
      const reasonStr = reason instanceof Error ? reason.message : String(reason);
      handleFailure('client_disconnect', `Client disconnected: ${reasonStr}`);
      reader.cancel(reason).catch(() => {});
    },
  });
}
