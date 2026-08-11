import { db } from '@/lib/db';
import { aiModels, aiProviders, billingPlans, paymentOrders, planModelAccess, userEntitlements } from '@/lib/db/schema';
import { eq, and, inArray, gt, isNull, or } from 'drizzle-orm';

/**
 * Model catalog service (US-034)
 *
 * Provides managed model catalog queries for both admin and user-facing APIs.
 */

export interface CatalogModel {
  id: string;
  providerId: string;
  providerType: string;
  modelIdentifier: string;
  displayName: string;
  family?: string;
  capabilities: string[];
  tier: string;
  deliveryResolution?: string;
  upscalerUrl?: string | null;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
  maxSteps: number | null;
  fixedPrice: number;
  tokenPriceInput: number;
  tokenPriceOutput: number;
}

/**
 * Get the user-facing catalog: only enabled models from active providers.
 * AC3: Returns only active + public models with capabilities and public pricing.
 * AC4: Never includes provider keys or internal service URLs.
 */
export async function getUserCatalog(userId?: string): Promise<CatalogModel[]> {
  const rows = await db
    .select({
      id: aiModels.id,
      providerId: aiModels.providerId,
      providerType: aiProviders.type,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      family: aiModels.family,
      capabilities: aiModels.capabilities,
      tier: aiModels.tier,
      deliveryResolution: aiModels.deliveryResolution,
      upscalerUrl: aiModels.upscalerUrl,
      inputTokenLimit: aiModels.inputTokenLimit,
      outputTokenLimit: aiModels.outputTokenLimit,
      maxSteps: aiModels.maxSteps,
      fixedPrice: aiModels.fixedPrice,
      tokenPriceInput: aiModels.tokenPriceInput,
      tokenPriceOutput: aiModels.tokenPriceOutput,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(
      and(
        eq(aiModels.status, 'active'),
        eq(aiModels.visibility, 'public'),
        eq(aiProviders.status, 'active'),
      ),
    );

  const allowedIds = userId ? await getAllowedModelIds(userId) : null;
  return rows.filter((r: typeof rows[number]) => allowedIds === null || allowedIds.has(r.id)).map((r: typeof rows[number]) => ({
    ...r,
    capabilities: typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : r.capabilities,
  }));
}

/**
 * Validate that a model is available for use.
 *
 * AC5: Returns MODEL_NOT_ALLOWED if model is disabled, not public, or provider is disabled.
 */
export async function validateModelAccess(modelId: string, userId?: string): Promise<
  { ok: true; model: CatalogModel } | { ok: false; error: 'MODEL_NOT_ALLOWED' }
> {
  const rows = await db
    .select({
      id: aiModels.id,
      providerId: aiModels.providerId,
      providerType: aiProviders.type,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      family: aiModels.family,
      capabilities: aiModels.capabilities,
      tier: aiModels.tier,
      deliveryResolution: aiModels.deliveryResolution,
      upscalerUrl: aiModels.upscalerUrl,
      inputTokenLimit: aiModels.inputTokenLimit,
      outputTokenLimit: aiModels.outputTokenLimit,
      maxSteps: aiModels.maxSteps,
      fixedPrice: aiModels.fixedPrice,
      tokenPriceInput: aiModels.tokenPriceInput,
      tokenPriceOutput: aiModels.tokenPriceOutput,
      modelStatus: aiModels.status,
      modelVisibility: aiModels.visibility,
      providerStatus: aiProviders.status,
    })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
    .where(eq(aiModels.id, modelId))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, error: 'MODEL_NOT_ALLOWED' };
  }

  const r = rows[0];
  if (r.modelStatus !== 'active' || r.providerStatus !== 'active' || r.modelVisibility !== 'public') {
    return { ok: false, error: 'MODEL_NOT_ALLOWED' };
  }
  if (userId) {
    const allowedIds = await getAllowedModelIds(userId);
    if (allowedIds !== null && !allowedIds.has(modelId)) {
      return { ok: false, error: 'MODEL_NOT_ALLOWED' };
    }
  }

  return {
    ok: true,
    model: {
      id: r.id,
      providerId: r.providerId,
      providerType: r.providerType,
      modelIdentifier: r.modelIdentifier,
      displayName: r.displayName,
      family: r.family,
      capabilities: typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : r.capabilities,
      tier: r.tier,
      deliveryResolution: r.deliveryResolution,
      upscalerUrl: r.upscalerUrl,
      inputTokenLimit: r.inputTokenLimit,
      outputTokenLimit: r.outputTokenLimit,
      maxSteps: r.maxSteps,
      fixedPrice: r.fixedPrice,
      tokenPriceInput: r.tokenPriceInput,
      tokenPriceOutput: r.tokenPriceOutput,
    },
  };
}

/** null means no access matrix has been configured yet (safe migration compatibility). */
async function getAllowedModelIds(userId: string): Promise<Set<string> | null> {
  const configured = await db.select({ id: planModelAccess.id }).from(planModelAccess)
    .where(eq(planModelAccess.enabled, true)).limit(1);
  if (configured.length === 0) return null;

  const [freePlans, entitlements, purchases] = await Promise.all([
    db.select({ id: billingPlans.id }).from(billingPlans).where(and(
      eq(billingPlans.active, true), eq(billingPlans.code, 'free'),
    )),
    db.select({ planId: userEntitlements.planId }).from(userEntitlements).where(and(
      eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active'),
      or(isNull(userEntitlements.currentPeriodEnd), gt(userEntitlements.currentPeriodEnd, new Date())),
    )),
    db.select({ planId: paymentOrders.planId }).from(paymentOrders)
      .innerJoin(billingPlans, eq(paymentOrders.planId, billingPlans.id)).where(and(
      eq(paymentOrders.userId, userId), inArray(paymentOrders.status, ['paid', 'partially_refunded']),
      eq(billingPlans.kind, 'credit_pack'),
    )),
  ]);
  const planIds = [...new Set([
    ...freePlans.map((row: { id: string }) => row.id),
    ...entitlements.map((row: { planId: string }) => row.planId),
    ...purchases.map((row: { planId: string }) => row.planId),
  ])];
  if (planIds.length === 0) return new Set();
  const access = await db.select({ modelId: planModelAccess.modelId }).from(planModelAccess)
    .where(and(inArray(planModelAccess.planId, planIds), eq(planModelAccess.enabled, true)));
  return new Set(access.map((row: { modelId: string }) => row.modelId));
}
