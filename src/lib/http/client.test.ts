import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from './json-client';
import { fetchJson } from './client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('returns a parsed successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));

    await expect(fetchJson<{ ok: boolean }>('/api/test')).resolves.toEqual({ ok: true });
  });

  it('does not retry or expose a SyntaxError for a plain-text HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJson('/api/test', { retry: 2 })).rejects.toEqual(
      new ApiResponseError(401, 'HTTP_401'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ recovered: true }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchJson<{ recovered: boolean }>('/api/test', { retry: 1 });
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
