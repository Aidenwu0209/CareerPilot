/**
 * Shared AI SDK model builder for gateway-integrated routes.
 *
 * Creates AI SDK model instances from the gateway dispatch context,
 * using managed credentials (never client-supplied).
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export interface ModelBuildContext {
  providerType: string;
  apiKey: string;
  baseUrl: string | null;
  modelIdentifier: string;
}

/**
 * Build an AI SDK model instance from gateway dispatch context.
 * Uses the managed provider credentials — never client-supplied keys.
 */
export function buildModel(ctx: ModelBuildContext) {
  if (ctx.providerType === 'anthropic') {
    const provider = createAnthropic({
      apiKey: ctx.apiKey,
      ...(ctx.baseUrl ? { baseURL: ctx.baseUrl } : {}),
    });
    return provider(ctx.modelIdentifier);
  }
  if (ctx.providerType === 'gemini' || ctx.providerType === 'google') {
    const provider = createGoogleGenerativeAI({
      apiKey: ctx.apiKey,
      ...(ctx.baseUrl ? { baseURL: ctx.baseUrl } : {}),
    });
    return provider(ctx.modelIdentifier);
  }
  // Default: OpenAI
  const provider = createOpenAI({
    apiKey: ctx.apiKey,
    ...(ctx.baseUrl ? { baseURL: ctx.baseUrl } : {}),
  });
  return provider.chat(ctx.modelIdentifier);
}

/**
 * Returns JSON mode provider options for OpenAI models.
 * Used by routes that need structured JSON output.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getJsonOptions(providerType: string): Record<string, any> {
  if (['openai', 'glm', 'deepseek', 'ernie', 'qianfan'].includes(providerType)) {
    return { openai: { response_format: { type: 'json_object' } } };
  }
  return {};
}
