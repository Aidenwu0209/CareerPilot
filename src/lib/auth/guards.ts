/**
 * Status Guards for Private API Routes
 *
 * After authentication (session cookie verified by middleware) and context
 * resolution, these guards enforce that the actor and their tenant are in an
 * active state before any business logic, AI provider call, or ledger hold.
 *
 * US-017 requirements:
 * - AC1: suspended user → 403 ACCOUNT_SUSPENDED
 * - AC2: disabled org / removed membership → stable rejection
 * - AC3: rejection happens BEFORE business writes, AI calls, and ledger holds
 * - AC4: unsuspend / re-enable → requests resume, no side effects
 */

import { NextResponse } from 'next/server';
import {
  resolveContext,
  RequestContext,
  AmbiguousBillingError,
} from './context';
import { config } from '@/lib/config';
import { FINGERPRINT_COOKIE_NAME } from './providers/fingerprint';

// ── Errors ──

/**
 * Thrown when the resolved actor has status = 'suspended'.
 * Routes should catch this and return 403 ACCOUNT_SUSPENDED.
 */
export class AccountSuspendedError extends Error {
  constructor() {
    super('ACCOUNT_SUSPENDED');
    this.name = 'AccountSuspendedError';
  }
}

// ── Guard Result ──

/**
 * Discriminated union returned by resolveActiveContext.
 *
 * - `null`              → no authenticated user (caller returns 401)
 * - `{ ok: false, response }` → access denied (caller returns the response)
 * - `{ ok: true, context }`   → proceed with business logic
 */
export type ActiveContextResult =
  | { ok: true; context: RequestContext }
  | { ok: false; response: NextResponse }
  | null;

// ── Primary Guard ──

/**
 * Resolve the request context and enforce active status.
 *
 * This is the recommended entry point for private API route handlers.
 * It resolves the full context (actor + tenant + billing) and verifies:
 *
 * 1. Actor is authenticated (returns null if not)
 * 2. Actor.status !== 'suspended' (returns 403 ACCOUNT_SUSPENDED)
 *
 * Organization/membership status is already enforced inside resolveContext():
 * disabled organizations and removed memberships are excluded from the
 * active membership query, causing the user to fall back to personal billing.
 *
 * @param fingerprint - Optional fingerprint for dev-only auth mode
 * @returns ActiveContextResult (see type definition)
 */
export async function resolveActiveContext(
  fingerprint?: string | null,
): Promise<ActiveContextResult> {
  let context: RequestContext | null;

  // Client hooks persist the development fingerprint as a SameSite cookie.
  // Reading it here prevents first-render API races without trusting any
  // fingerprint in production, where session auth remains mandatory.
  let effectiveFingerprint = fingerprint;
  if (effectiveFingerprint === undefined && process.env.NODE_ENV === 'development' && !config.auth.enabled) {
    const { cookies } = await import('next/headers');
    effectiveFingerprint = (await cookies()).get(FINGERPRINT_COOKIE_NAME)?.value ?? null;
  }

  try {
    context = await resolveContext(effectiveFingerprint);
  } catch (error) {
    if (error instanceof AmbiguousBillingError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'AMBIGUOUS_BILLING',
            organizationIds: error.organizationIds,
          },
          { status: 400 },
        ),
      };
    }
    throw error;
  }

  // No authenticated user
  if (!context) return null;

  // AC1: suspended or deleted user → reject ALL private API operations
  if (context.actor.status !== 'active') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'ACCOUNT_SUSPENDED' },
        { status: 403 },
      ),
    };
  }

  // AC2: org/membership status is enforced inside resolveContext().
  // Disabled orgs and removed memberships are filtered out, so the user
  // resolves to personal context instead of org context. This is the
  // "stable rejection" — they cannot consume org resources or quota.
  // Explicit org-scoped routes (admin APIs) will add their own membership
  // checks on top of this in later stories.

  return { ok: true, context };
}

/**
 * Synchronous assertion variant for cases where the caller already has a
 * resolved context and just needs to check the status.
 *
 * @throws {AccountSuspendedError} if actor.status === 'suspended'
 */
export function assertActorActive(context: RequestContext): void {
  if (context.actor.status !== 'active') {
    throw new AccountSuspendedError();
  }
}
