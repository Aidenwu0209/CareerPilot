import { describe, expect, it } from 'vitest';
import { ApiResponseError } from './json-client';
import { getFriendlyApiErrorKey } from './error-messages';

describe('getFriendlyApiErrorKey', () => {
  it('maps stable API codes before HTTP status fallbacks', () => {
    expect(getFriendlyApiErrorKey(new ApiResponseError(400, 'RATE_LIMITED'))).toBe('rateLimited');
  });

  it('maps authentication and upstream failures without exposing raw text', () => {
    expect(getFriendlyApiErrorKey(new ApiResponseError(401, 'HTTP_401'))).toBe('unauthorized');
    expect(getFriendlyApiErrorKey(new ApiResponseError(503, 'HTTP_503'))).toBe('unavailable');
  });

  it('distinguishes offline and network failures', () => {
    expect(getFriendlyApiErrorKey(new TypeError('fetch failed'), false)).toBe('offline');
    expect(getFriendlyApiErrorKey(new TypeError('fetch failed'), true)).toBe('network');
  });
});
