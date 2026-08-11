import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchManagedImageEdit } from './image-dispatch';
import type { GatewayDispatchContext } from './gateway';

const baseContext: GatewayDispatchContext = {
  modelIdentifier: 'image-model',
  providerType: 'google',
  apiKey: 'managed-secret',
  baseUrl: null,
  operationId: 'operation-1',
  modelId: 'model-1',
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.IMAGE_UPSCALER_API_KEY;
});

describe('managed image dispatch', () => {
  it('dispatches Google image edits with managed headers and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'done' }, { inlineData: { mimeType: 'image/png', data: 'result' } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchManagedImageEdit(baseContext, {
      prompt: 'professional headshot', mimeType: 'image/jpeg', base64Data: 'source', aspectRatio: '4:3',
    });

    expect(result.image).toBe('data:image/png;base64,result');
    expect(result.usage?.totalTokens).toBe(20);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('managed-secret');
    expect(String(init.body)).not.toContain('managed-secret');
  });

  it('dispatches OpenAI image edits through the catalog provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'edited-image', revised_prompt: 'refined' }],
      output_format: 'png',
      usage: { input_tokens: 40, output_tokens: 60, total_tokens: 100 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchManagedImageEdit(
      { ...baseContext, providerType: 'openai', modelIdentifier: 'gpt-image-1.5' },
      { prompt: 'professional headshot', mimeType: 'image/jpeg', base64Data: 'source', aspectRatio: '16:9' },
    );

    expect(result.image).toBe('data:image/png;base64,edited-image');
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 60, totalTokens: 100 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer managed-secret');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-image-1.5', size: '1536x1024', input_fidelity: 'high',
    });
  });

  it('dispatches ERNIE image edits through Qianfan v2', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'ernie-image' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await dispatchManagedImageEdit(
      { ...baseContext, providerType: 'ernie', modelIdentifier: 'ernie-image-turbo' },
      { prompt: 'professional headshot', mimeType: 'image/png', base64Data: 'c291cmNl' },
    );
    expect(result.image).toBe('data:image/png;base64,ernie-image');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qianfan.baidubce.com/v2/images/edits');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer managed-secret');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('uses a separately configured upscaler for the GPT 4K delivery tier', async () => {
    process.env.IMAGE_UPSCALER_API_KEY = 'upscaler-secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'one-k' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ image: 'data:image/png;base64,four-k' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await dispatchManagedImageEdit(
      { ...baseContext, providerType: 'openai', modelIdentifier: 'gpt-image-1.5', deliveryResolution: '4k', upscalerUrl: 'https://api.openai.com/v1/upscale' },
      { prompt: 'professional headshot', mimeType: 'image/png', base64Data: 'source' },
    );
    expect(result.image).toBe('data:image/png;base64,four-k');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/upscale');
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe('Bearer upscaler-secret');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ targetResolution: '4k' });
  });

  it('rejects unsupported and non-allowlisted providers', async () => {
    await expect(dispatchManagedImageEdit(
      { ...baseContext, providerType: 'anthropic' },
      { prompt: 'x', mimeType: 'image/png', base64Data: 'x' },
    )).rejects.toThrow('IMAGE_PROVIDER_UNSUPPORTED');
    await expect(dispatchManagedImageEdit(
      { ...baseContext, providerType: 'openai', baseUrl: 'https://evil.example.com' },
      { prompt: 'x', mimeType: 'image/png', base64Data: 'x' },
    )).rejects.toThrow('UPSTREAM_URL_NOT_ALLOWED');
  });

  it('classifies provider failures without retaining the upstream body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'model image-preview not found; key=secret-value' } }),
      { status: 404 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await dispatchManagedImageEdit(
        { ...baseContext, modelIdentifier: 'image-preview' },
        { prompt: 'x', mimeType: 'image/png', base64Data: 'x' },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'PROVIDER_MODEL_UNAVAILABLE',
      clientStatus: 502,
      retryable: false,
    });
    expect(String(caught)).not.toContain('secret-value');
  });
});
