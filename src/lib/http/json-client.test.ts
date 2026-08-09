import { describe, expect, it } from 'vitest';
import { ApiResponseError, readJsonResponse } from './json-client';

describe('readJsonResponse', () => {
  it('returns parsed JSON for a successful response', async () => {
    const response = Response.json({ ok: true });

    await expect(readJsonResponse<{ ok: boolean }>(response)).resolves.toEqual({ ok: true });
  });

  it('turns a JSON API error into a stable ApiResponseError', async () => {
    const response = Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });

    await expect(readJsonResponse(response)).rejects.toMatchObject({
      name: 'ApiResponseError',
      status: 401,
      code: 'AUTH_REQUIRED',
    });
  });

  it('turns a plain-text Unauthorized response into a stable ApiResponseError', async () => {
    const response = new Response('Unauthorized', { status: 401 });

    await expect(readJsonResponse(response)).rejects.toEqual(
      new ApiResponseError(401, 'Unauthorized'),
    );
  });
});
