export type ManagedProviderErrorCode =
  | 'PROVIDER_CREDENTIALS_REJECTED'
  | 'PROVIDER_MODEL_UNAVAILABLE'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'PROVIDER_REQUEST_REJECTED'
  | 'PROVIDER_UPSTREAM_UNAVAILABLE';

/**
 * A sanitized provider failure that is safe to persist and return to clients.
 * Raw upstream bodies must never be stored on this error.
 */
export class ManagedProviderError extends Error {
  constructor(
    readonly code: ManagedProviderErrorCode,
    readonly clientStatus: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ManagedProviderError';
  }
}

const MODEL_FAILURE_MARKERS = [
  'not found',
  'not support',
  'unsupported',
  'does not exist',
  'not available',
];

const CREDENTIAL_FAILURE_MARKERS = [
  'api key not valid',
  'api_key_invalid',
  'invalid api key',
  'invalid_api_key',
  'permission denied',
  'unauthenticated',
  'authentication failed',
  'invalid token',
];

/** Convert an upstream HTTP failure into a bounded, non-sensitive error. */
export async function managedProviderErrorFromResponse(
  response: Response,
): Promise<ManagedProviderError> {
  let body = '';
  try {
    body = (await response.text()).slice(0, 4_096).toLowerCase();
  } catch {
    // Classification can fall back to the HTTP status.
  }

  const modelUnavailable =
    body.includes('model') && MODEL_FAILURE_MARKERS.some((marker) => body.includes(marker));
  if (modelUnavailable) {
    return new ManagedProviderError(
      'PROVIDER_MODEL_UNAVAILABLE',
      502,
      false,
      'The selected AI model is unavailable at the provider.',
    );
  }

  if (
    response.status === 429 ||
    body.includes('quota') ||
    body.includes('resource_exhausted') ||
    body.includes('rate limit')
  ) {
    return new ManagedProviderError(
      'PROVIDER_QUOTA_EXCEEDED',
      503,
      false,
      'The AI provider plan may not include this model, or its rate limit or quota has been reached.',
    );
  }

  const credentialsRejected = CREDENTIAL_FAILURE_MARKERS.some((marker) => body.includes(marker));
  if (response.status === 401 || response.status === 403 || credentialsRejected) {
    return new ManagedProviderError(
      'PROVIDER_CREDENTIALS_REJECTED',
      502,
      false,
      'The AI provider rejected the configured credentials.',
    );
  }

  if (response.status >= 500) {
    return new ManagedProviderError(
      'PROVIDER_UPSTREAM_UNAVAILABLE',
      503,
      true,
      'The AI provider is temporarily unavailable.',
    );
  }

  return new ManagedProviderError(
    'PROVIDER_REQUEST_REJECTED',
    502,
    false,
    'The AI provider rejected the request.',
  );
}

export function isManagedProviderError(error: unknown): error is ManagedProviderError {
  return error instanceof ManagedProviderError;
}
