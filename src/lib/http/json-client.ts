/** A stable client-side error for API responses, including non-JSON proxies. */
export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ApiResponseError';
  }
}

function errorCodeFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error) return record.error;
    if (typeof record.message === 'string' && record.message) return record.message;
  }
  return fallback;
}

/**
 * Parse a JSON API response without leaking `Unexpected token` errors to the UI.
 * Non-JSON error bodies (for example a proxy's plain-text "Unauthorized") are
 * converted into ApiResponseError with a predictable code.
 */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  let body: unknown = null;

  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      const fallback = response.ok
        ? 'INVALID_JSON_RESPONSE'
        : rawBody.trim() || `HTTP_${response.status}`;
      throw new ApiResponseError(response.status, fallback);
    }
  }

  if (!response.ok) {
    throw new ApiResponseError(
      response.status,
      errorCodeFromBody(body, `HTTP_${response.status}`),
    );
  }

  return body as T;
}
