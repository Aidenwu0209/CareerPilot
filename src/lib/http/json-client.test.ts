import { describe, expect, it } from 'vitest';
import {
  ApiResponseError,
  readJsonResponse,
  readOptionalJsonBody,
} from './json-client';

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

  it('turns a plain-text Unauthorized response into a sanitized ApiResponseError', async () => {
    const response = new Response('Unauthorized', { status: 401 });

    await expect(readJsonResponse(response)).rejects.toEqual(
      new ApiResponseError(401, 'HTTP_401'),
    );
  });

  it('does not expose an HTML proxy error body', async () => {
    const response = new Response('<html>private proxy detail</html>', { status: 502 });

    await expect(readJsonResponse(response)).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_502',
    });
  });

  it('reports invalid JSON from a successful response without a SyntaxError', async () => {
    const response = new Response('not-json', { status: 200 });

    await expect(readJsonResponse(response)).rejects.toEqual(
      new ApiResponseError(200, 'INVALID_JSON_RESPONSE'),
    );
  });
});

describe('readOptionalJsonBody', () => {
  it('returns null for a plain-text error response', async () => {
    await expect(
      readOptionalJsonBody(new Response('Unauthorized', { status: 401 })),
    ).resolves.toBeNull();
  });

  it('returns a structured body even when the response is not ok', async () => {
    await expect(
      readOptionalJsonBody<{ error: string }>(
        Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 }),
      ),
    ).resolves.toEqual({ error: 'AUTH_REQUIRED' });
  });
});
