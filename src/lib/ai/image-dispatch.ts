import type { GatewayDispatchContext } from '@/lib/ai/gateway';
import { SSRF_SAFE_FETCH_OPTIONS, validateUpstreamUrl } from '@/lib/security/ssrf-guard';

export interface ImageEditInput {
  prompt: string;
  mimeType: string;
  base64Data: string;
  aspectRatio?: string;
}

export interface ImageEditResult {
  image: string;
  text: string | null;
  safetyFiltered?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openai: 'https://api.openai.com/v1',
  ernie: 'https://qianfan.baidubce.com/v2',
};

export async function dispatchManagedImageEdit(
  context: GatewayDispatchContext,
  input: ImageEditInput,
): Promise<ImageEditResult> {
  const providerType = context.providerType.toLowerCase();
  if (providerType === 'google' || providerType === 'gemini') {
    return deliverResolution(context, await dispatchGoogle(context, input));
  }
  if (providerType === 'openai') {
    return deliverResolution(context, await dispatchOpenAI(context, input));
  }
  if (providerType === 'ernie' || providerType === 'baidu' || providerType === 'qianfan') {
    return deliverResolution(context, await dispatchErnie(context, input));
  }
  throw new Error('IMAGE_PROVIDER_UNSUPPORTED');
}

async function dispatchErnie(
  context: GatewayDispatchContext,
  input: ImageEditInput,
): Promise<ImageEditResult> {
  const baseUrl = resolveBaseUrl(context, 'ernie');
  const bytes = Buffer.from(input.base64Data, 'base64');
  const form = new FormData();
  form.append('model', context.modelIdentifier);
  form.append('prompt', input.prompt);
  form.append('image', new Blob([bytes], { type: input.mimeType }), 'input.png');
  const response = await fetch(`${baseUrl}/images/edits`, {
    ...SSRF_SAFE_FETCH_OPTIONS,
    method: 'POST',
    headers: { Authorization: `Bearer ${context.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw new Error(`IMAGE_PROVIDER_ERROR_${response.status}`);
  const data = await response.json();
  const first = data?.data?.[0];
  const image = first?.b64_json
    ? `data:image/png;base64,${first.b64_json}`
    : typeof first?.url === 'string' ? first.url : null;
  if (!image) throw new Error('IMAGE_PROVIDER_EMPTY_RESPONSE');
  return { image, text: first.revised_prompt ?? null };
}

async function deliverResolution(
  context: GatewayDispatchContext,
  result: ImageEditResult,
): Promise<ImageEditResult> {
  if (context.deliveryResolution !== '4k') return result;
  if (!context.upscalerUrl) throw new Error('IMAGE_4K_UPSCALER_NOT_CONFIGURED');
  const upscalerApiKey = process.env.IMAGE_UPSCALER_API_KEY;
  if (!upscalerApiKey) throw new Error('IMAGE_4K_UPSCALER_CREDENTIAL_NOT_CONFIGURED');
  if (!validateUpstreamUrl(context.upscalerUrl).ok) throw new Error('UPSTREAM_URL_NOT_ALLOWED');
  const response = await fetch(context.upscalerUrl, {
    ...SSRF_SAFE_FETCH_OPTIONS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${upscalerApiKey}`,
    },
    body: JSON.stringify({ image: result.image, targetResolution: '4k', outputFormat: 'png' }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`IMAGE_UPSCALER_ERROR_${response.status}`);
  const data = await response.json();
  const image = data.image ?? data.output?.image ?? data.data?.[0]?.b64_json;
  if (!image) throw new Error('IMAGE_UPSCALER_EMPTY_RESPONSE');
  return {
    ...result,
    image: typeof image === 'string' && image.startsWith('data:')
      ? image
      : `data:image/png;base64,${image}`,
  };
}

async function dispatchGoogle(
  context: GatewayDispatchContext,
  input: ImageEditInput,
): Promise<ImageEditResult> {
  const baseUrl = resolveBaseUrl(context, 'google');
  const endpoint = `${baseUrl}/models/${encodeURIComponent(context.modelIdentifier)}:generateContent`;
  const response = await fetch(endpoint, {
    ...SSRF_SAFE_FETCH_OPTIONS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': context.apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: input.prompt },
          { inlineData: { mimeType: input.mimeType, data: input.base64Data } },
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(input.aspectRatio && input.aspectRatio !== '1:1'
          ? { responseFormat: { image: { aspectRatio: input.aspectRatio } } }
          : {}),
      },
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw new Error(`IMAGE_PROVIDER_ERROR_${response.status}`);

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    if ((candidate?.finishReason ?? candidate?.finish_reason) === 'SAFETY') {
      return { image: '', text: null, safetyFiltered: true, usage: googleUsage(data) };
    }
    throw new Error('IMAGE_PROVIDER_EMPTY_RESPONSE');
  }

  let image: string | null = null;
  let text: string | null = null;
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      image = `data:${inline.mimeType ?? inline.mime_type ?? 'image/png'};base64,${inline.data}`;
    }
    if (typeof part.text === 'string') text = part.text;
  }
  if (!image) throw new Error('IMAGE_PROVIDER_EMPTY_RESPONSE');
  return { image, text, usage: googleUsage(data) };
}

async function dispatchOpenAI(
  context: GatewayDispatchContext,
  input: ImageEditInput,
): Promise<ImageEditResult> {
  const baseUrl = resolveBaseUrl(context, 'openai');
  const response = await fetch(`${baseUrl}/images/edits`, {
    ...SSRF_SAFE_FETCH_OPTIONS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.apiKey}`,
    },
    body: JSON.stringify({
      model: context.modelIdentifier,
      prompt: input.prompt,
      images: [{ image_url: `data:${input.mimeType};base64,${input.base64Data}` }],
      input_fidelity: 'high',
      output_format: 'png',
      size: aspectRatioToOpenAISize(input.aspectRatio),
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) throw new Error(`IMAGE_PROVIDER_ERROR_${response.status}`);

  const data = await response.json();
  const first = data?.data?.[0];
  if (!first?.b64_json) throw new Error('IMAGE_PROVIDER_EMPTY_RESPONSE');
  const usage = data?.usage;
  return {
    image: `data:image/${data.output_format ?? 'png'};base64,${first.b64_json}`,
    text: first.revised_prompt ?? null,
    usage: usage ? {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
    } : undefined,
  };
}

function resolveBaseUrl(context: GatewayDispatchContext, normalizedType: 'google' | 'openai' | 'ernie'): string {
  const baseUrl = (context.baseUrl || DEFAULT_BASE_URLS[normalizedType]).replace(/\/$/, '');
  if (!validateUpstreamUrl(baseUrl).ok) throw new Error('UPSTREAM_URL_NOT_ALLOWED');
  return baseUrl;
}

function googleUsage(data: Record<string, unknown>) {
  const raw = data.usageMetadata as Record<string, number> | undefined;
  if (!raw) return undefined;
  return {
    inputTokens: raw.promptTokenCount,
    outputTokens: raw.candidatesTokenCount,
    totalTokens: raw.totalTokenCount,
  };
}

function aspectRatioToOpenAISize(aspectRatio?: string): '1024x1024' | '1536x1024' | '1024x1536' | 'auto' {
  if (!aspectRatio || aspectRatio === '1:1') return '1024x1024';
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!width || !height) return 'auto';
  return width > height ? '1536x1024' : '1024x1536';
}
