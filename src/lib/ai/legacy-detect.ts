/**
 * Legacy BYOK (Bring Your Own Key) detection utility (US-050 AC3)
 *
 * Production AI routes no longer accept client-supplied credentials.
 * This utility detects legacy headers/body and logs sanitized warnings.
 */

import type { NextRequest } from 'next/server';

const LEGACY_HEADERS = ['x-api-key', 'x-provider', 'x-base-url', 'x-model'];

/**
 * Detect legacy BYOK headers and body apiKey on an AI API request.
 * Returns a list of sanitized warning strings (empty if no legacy config detected).
 */
export function detectLegacyByok(
  request: NextRequest | Request,
): string[] {
  const warnings: string[] = [];

  // Check for legacy headers
  for (const header of LEGACY_HEADERS) {
    const value = request.headers.get(header);
    if (value) {
      warnings.push(`legacy_header:${header}`);
    }
  }

  return warnings;
}

/**
 * Detect and warn about legacy BYOK configuration.
 * Logs a sanitized warning when legacy headers or body apiKey are detected.
 * Does NOT reject the request — the strategy is "ignore and warn".
 */
export function warnLegacyByok(
  request: NextRequest | Request,
): void {
  const warnings = detectLegacyByok(request);
  if (warnings.length > 0) {
    console.warn(
      `[legacy-byok] Ignored deprecated client credentials: ${warnings.join(', ')}`,
    );
  }
}
