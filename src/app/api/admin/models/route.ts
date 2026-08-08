import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { aiModels, aiProviders } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';

/**
 * GET /api/admin/models
 *
 * Super admin: list all models (including disabled).
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const models = await db
    .select({
      id: aiModels.id,
      providerId: aiModels.providerId,
      providerName: aiProviders.name,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      capabilities: aiModels.capabilities,
      tier: aiModels.tier,
      status: aiModels.status,
      visibility: aiModels.visibility,
      inputTokenLimit: aiModels.inputTokenLimit,
      outputTokenLimit: aiModels.outputTokenLimit,
      maxSteps: aiModels.maxSteps,
      fixedPrice: aiModels.fixedPrice,
      tokenPriceInput: aiModels.tokenPriceInput,
      tokenPriceOutput: aiModels.tokenPriceOutput,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .orderBy(desc(aiModels.createdAt));

  return NextResponse.json({ models });
}

/**
 * POST /api/admin/models
 *
 * Super admin: create a new model.
 *
 * AC1: Configure capabilities, limits, tier, and pricing.
 * AC2: Validate negative prices, invalid limits, duplicate identifier, non-existent provider.
 */
export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: {
    providerId?: string;
    modelIdentifier?: string;
    displayName?: string;
    capabilities?: string[];
    tier?: string;
    visibility?: string;
    status?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    maxSteps?: number;
    fixedPrice?: number;
    tokenPriceInput?: number;
    tokenPriceOutput?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const {
    providerId, modelIdentifier, displayName, capabilities,
    tier, visibility, status,
    inputTokenLimit, outputTokenLimit, maxSteps,
    fixedPrice, tokenPriceInput, tokenPriceOutput,
  } = body;

  // AC2: Validate required fields
  if (!providerId) return NextResponse.json({ error: 'PROVIDER_ID_REQUIRED' }, { status: 400 });
  if (!modelIdentifier || typeof modelIdentifier !== 'string') return NextResponse.json({ error: 'MODEL_IDENTIFIER_REQUIRED' }, { status: 400 });
  if (!displayName || typeof displayName !== 'string') return NextResponse.json({ error: 'DISPLAY_NAME_REQUIRED' }, { status: 400 });

  // AC2: Validate provider exists
  const provider = await db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
  if (provider.length === 0) {
    return NextResponse.json({ error: 'PROVIDER_NOT_FOUND' }, { status: 400 });
  }

  // AC2: Validate no duplicate modelIdentifier for this provider
  const existing = await db.select({ id: aiModels.id }).from(aiModels)
    .where(and(eq(aiModels.providerId, providerId), eq(aiModels.modelIdentifier, modelIdentifier)))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: 'MODEL_IDENTIFIER_EXISTS', detail: `Model identifier '${modelIdentifier}' already exists for this provider` }, { status: 409 });
  }

  // AC2: Validate prices are non-negative
  if (fixedPrice !== undefined && (typeof fixedPrice !== 'number' || fixedPrice < 0)) {
    return NextResponse.json({ error: 'INVALID_FIXED_PRICE' }, { status: 400 });
  }
  if (tokenPriceInput !== undefined && (typeof tokenPriceInput !== 'number' || tokenPriceInput < 0)) {
    return NextResponse.json({ error: 'INVALID_TOKEN_PRICE_INPUT' }, { status: 400 });
  }
  if (tokenPriceOutput !== undefined && (typeof tokenPriceOutput !== 'number' || tokenPriceOutput < 0)) {
    return NextResponse.json({ error: 'INVALID_TOKEN_PRICE_OUTPUT' }, { status: 400 });
  }

  // AC2: Validate limits
  if (inputTokenLimit !== undefined && (typeof inputTokenLimit !== 'number' || inputTokenLimit < 0)) {
    return NextResponse.json({ error: 'INVALID_INPUT_TOKEN_LIMIT' }, { status: 400 });
  }
  if (outputTokenLimit !== undefined && (typeof outputTokenLimit !== 'number' || outputTokenLimit < 0)) {
    return NextResponse.json({ error: 'INVALID_OUTPUT_TOKEN_LIMIT' }, { status: 400 });
  }
  if (maxSteps !== undefined && (typeof maxSteps !== 'number' || maxSteps < 0)) {
    return NextResponse.json({ error: 'INVALID_MAX_STEPS' }, { status: 400 });
  }

  const modelId = crypto.randomUUID();
  await db.insert(aiModels).values({
    id: modelId,
    providerId,
    modelIdentifier,
    displayName,
    capabilities: capabilities ?? ['text'],
    tier: tier ?? 'standard',
    status: (status === 'disabled' ? 'disabled' : 'active'),
    visibility: visibility ?? 'public',
    inputTokenLimit: inputTokenLimit ?? null,
    outputTokenLimit: outputTokenLimit ?? null,
    maxSteps: maxSteps ?? null,
    fixedPrice: fixedPrice ?? 0,
    tokenPriceInput: tokenPriceInput ?? 0,
    tokenPriceOutput: tokenPriceOutput ?? 0,
  });

  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'model.create',
    targetType: 'ai_model',
    targetId: modelId,
    result: 'success',
    summary: `Created model '${displayName}' (${modelIdentifier})`,
  });

  const created = await db.select().from(aiModels).where(eq(aiModels.id, modelId)).limit(1);
  return NextResponse.json({ model: created[0] }, { status: 201 });
}
