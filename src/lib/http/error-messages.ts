import { ApiResponseError } from './json-client';

export type FriendlyApiErrorKey =
  | 'invalidInput'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'tooLarge'
  | 'rateLimited'
  | 'server'
  | 'unavailable'
  | 'invalidResponse'
  | 'network'
  | 'offline'
  | 'unknown';

const CODE_MAP: Record<string, FriendlyApiErrorKey> = {
  INVALID_INPUT: 'invalidInput',
  VALIDATION_ERROR: 'invalidInput',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rateLimited',
  SERVER_ERROR: 'server',
  INVALID_JSON_RESPONSE: 'invalidResponse',
};

const STATUS_MAP: Record<number, FriendlyApiErrorKey> = {
  400: 'invalidInput',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  413: 'tooLarge',
  429: 'rateLimited',
  500: 'server',
  502: 'unavailable',
  503: 'unavailable',
  504: 'unavailable',
};

/** Convert transport and API errors to stable translation keys, never raw server text. */
export function getFriendlyApiErrorKey(error: unknown, online = true): FriendlyApiErrorKey {
  if (!online) return 'offline';
  if (error instanceof ApiResponseError) {
    return CODE_MAP[error.code]
      ?? STATUS_MAP[error.status]
      ?? (error.status >= 500 ? 'server' : 'unknown');
  }
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}
