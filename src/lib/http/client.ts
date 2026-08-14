'use client';

import { ApiResponseError, readJsonResponse } from './json-client';

function notifyRequestFailure(detail: { message: string; retryable: boolean }) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('careerpilot:request-error', { detail }));
  }
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit & { retry?: number },
): Promise<T> {
  const attempts = Math.max(1, (init?.retry ?? 0) + 1);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const requestInit = { ...(init ?? {}) };
      delete requestInit.retry;
      const response = await fetch(input, requestInit);
      return await readJsonResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiResponseError) throw error;
      lastError = error;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 350 * (attempt + 1)));
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Network request failed';
  notifyRequestFailure({ message, retryable: true });
  throw lastError;
}
