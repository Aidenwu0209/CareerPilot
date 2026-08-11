import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getUserIdFromRequest } from '@/lib/auth/helpers';
import {
  checkRateLimit,
  rateLimitedResponse,
  RATE_LIMIT_POLICIES,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';
import { getUserCatalog } from '@/lib/ai/model-catalog';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';

/**
 * GET /api/ai/models
 *
 * Returns the server-side managed model catalog for the current account.
 *
 * AC3: Only returns enabled, public models with capabilities and public pricing.
 * AC4: Response never includes provider keys or internal service URLs.
 */
export async function GET(request: Request) {
  await warnLegacyByok(request);
  // Verify authentication and active status before any provider calls
  const ctx = await resolveActiveContext(getUserIdFromRequest(request));
  if (ctx === null) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  // Rate limit: per-user, fail-open (read-only catalog lookup)
  const rlResult = await checkRateLimit(
    rateLimitKey('ai-models', 'user', ctx.context.actor.userId),
    RATE_LIMIT_POLICIES.aiModels,
  );
  if (!rlResult.allowed) {
    return rateLimitedResponse(rlResult.retryAfter);
  }

  const models = await getUserCatalog(ctx.context.actor.userId);

  // AC4: Return only safe, public fields — no keys, no internal URLs
  return NextResponse.json({
    models: models.map((m) => ({
      id: m.id,
      modelIdentifier: m.modelIdentifier,
      displayName: m.displayName,
      family: m.family,
      providerType: m.providerType,
      capabilities: m.capabilities,
      tier: m.tier,
      deliveryResolution: m.deliveryResolution,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      maxSteps: m.maxSteps,
      fixedPrice: m.fixedPrice,
      tokenPriceInput: m.tokenPriceInput,
      tokenPriceOutput: m.tokenPriceOutput,
    })),
  });
}
