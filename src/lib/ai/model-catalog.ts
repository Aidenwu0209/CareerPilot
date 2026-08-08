import { db } from '@/lib/db';
import { aiModels, aiProviders } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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
  capabilities: string[];
  tier: string;
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
export async function getUserCatalog(): Promise<CatalogModel[]> {
  const rows = await db
    .select({
      id: aiModels.id,
      providerId: aiModels.providerId,
      providerType: aiProviders.type,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      capabilities: aiModels.capabilities,
      tier: aiModels.tier,
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

  return rows.map((r: typeof rows[number]) => ({
    ...r,
    capabilities: typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : r.capabilities,
  }));
}

/**
 * Validate that a model is available for use.
 *
 * AC5: Returns MODEL_NOT_ALLOWED if model is disabled, not public, or provider is disabled.
 */
export async function validateModelAccess(modelId: string): Promise<
  { ok: true; model: CatalogModel } | { ok: false; error: 'MODEL_NOT_ALLOWED' }
> {
  const rows = await db
    .select({
      id: aiModels.id,
      providerId: aiModels.providerId,
      providerType: aiProviders.type,
      modelIdentifier: aiModels.modelIdentifier,
      displayName: aiModels.displayName,
      capabilities: aiModels.capabilities,
      tier: aiModels.tier,
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

  return {
    ok: true,
    model: {
      id: r.id,
      providerId: r.providerId,
      providerType: r.providerType,
      modelIdentifier: r.modelIdentifier,
      displayName: r.displayName,
      capabilities: typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : r.capabilities,
      tier: r.tier,
      inputTokenLimit: r.inputTokenLimit,
      outputTokenLimit: r.outputTokenLimit,
      maxSteps: r.maxSteps,
      fixedPrice: r.fixedPrice,
      tokenPriceInput: r.tokenPriceInput,
      tokenPriceOutput: r.tokenPriceOutput,
    },
  };
}
