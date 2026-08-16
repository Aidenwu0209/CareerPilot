/**
 * Legacy BYOK (Bring Your Own Key) detection utility (US-050 AC3)
 *
 * Production AI routes no longer accept client-supplied credentials.
 * This utility detects legacy headers/body and logs sanitized warnings.
 */

import type { NextRequest } from 'next/server';
import { logger } from '@/lib/observability/logger';

const LEGACY_HEADERS = ['x-api-key', 'x-provider', 'x-base-url', 'x-model'];
const LEGACY_BODY_KEYS = ['apiKey', 'api_key', 'provider', 'baseURL', 'baseUrl'];

/**
 * Detect legacy BYOK headers on an AI API request.
 * Returns a list of sanitized warning strings (empty if no legacy config detected).
 */
export function detectLegacyByokHeaders(
  request: NextRequest | Request,
): string[] {
  const warnings: string[] = [];

  for (const header of LEGACY_HEADERS) {
    const value = request.headers.get(header);
    if (value) {
      warnings.push(`legacy_header:${header}`);
    }
  }

  return warnings;
}

/**
 * Detect legacy BYOK fields in a parsed JSON body.
 * Returns a list of sanitized warning strings.
 */
export function detectLegacyByokBody(body: unknown): string[] {
  const warnings: string[] = [];
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    for (const key of LEGACY_BODY_KEYS) {
      if (key in obj && obj[key] != null && obj[key] !== '') {
        warnings.push(`legacy_body:${key}`);
      }
    }
  }
  return warnings;
}

/**
 * Detect and warn about legacy BYOK configuration.
 * Checks both headers and (for JSON requests) the body for legacy credential fields.
 * Logs a sanitized warning when legacy configuration is detected.
 * Does NOT reject the request — the strategy is "ignore and warn".
 *
 * This is async because it may clone and read the request body for JSON detection.
 */
export async function warnLegacyByok(
  request: NextRequest | Request,
): Promise<void> {
  const warnings = detectLegacyByokHeaders(request);

  // Check body for legacy apiKey/provider/baseUrl fields (JSON only)
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const clone = request.clone();
      const body = await clone.json();
      warnings.push(...detectLegacyByokBody(body));
    } catch {
      // Body is not valid JSON or already consumed — skip body detection
    }
  }

  if (warnings.length > 0) {
    logger.warn('legacy-byok.ignored', { fields: warnings });
  }
}
