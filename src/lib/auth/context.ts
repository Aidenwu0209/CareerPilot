/**
 * Unified Actor, Tenant & Billing Context Resolution
 *
 * This is the single entry point for determining WHO is acting, WHICH tenant
 * they belong to, and WHICH billing account should be charged.
 *
 * Design principles:
 * - Actor is resolved from the server-side session (never client-supplied).
 * - Org context comes ONLY from valid DB membership records.
 * - Client-supplied userId, role, organizationId are NEVER trusted.
 * - The returned context object contains NO provider credentials or secrets.
 */

import { resolveUser } from './helpers';
import { db } from '@/lib/db';
import { organizationMemberships, organizations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// ── Types ──

/**
 * Resolved actor (authenticated user) with platform-level attributes.
 */
export interface Actor {
  userId: string;
  platformRole: 'super_admin' | 'user';
  status: 'active' | 'suspended';
}

/**
 * Resolved tenant context — determines which entity's resources are accessed.
 */
export interface Tenant {
  type: 'personal' | 'organization';
  organizationId: string | null;
  orgRole: 'org_admin' | 'member' | null;
}

/**
 * Resolved billing context — determines which credit account is charged.
 */
export interface Billing {
  accountOwnerType: 'user' | 'organization';
  accountOwnerId: string;
}

/**
 * Unified request context — the single source of truth for authorization
 * and billing in API routes and server actions.
 *
 * IMPORTANT: This object never contains provider credentials, API keys,
 * encrypted secrets, or any data that could leak if serialized to the client.
 */
export interface RequestContext {
  actor: Actor;
  tenant: Tenant;
  billing: Billing;
}

// ── Errors ──

/**
 * Thrown when a user has multiple active organization memberships,
 * making the billing context ambiguous.
 */
export class AmbiguousBillingError extends Error {
  constructor(public organizationIds: string[]) {
    super(
      `Multiple active organization memberships detected (${organizationIds.length}). ` +
        'Cannot determine billing context automatically. Please specify which organization to use.',
    );
    this.name = 'AmbiguousBillingError';
  }
}

// ── Resolution ──

/**
 * Internal: resolve the tenant and billing context for a known user.
 *
 * Rules:
 * - 0 active org memberships → personal billing
 * - 1 active org membership → org billing
 * - >1 active org memberships → AmbiguousBillingError (no silent selection)
 *
 * "Active" means: membership.status = 'active' AND organization.status = 'active'.
 */
export async function resolveContextForUser(user: {
  id: string;
  platformRole: 'super_admin' | 'user';
  status: 'active' | 'suspended';
}): Promise<RequestContext> {
  const actor: Actor = {
    userId: user.id,
    platformRole: user.platformRole,
    status: user.status,
  };

  // Load active memberships where the org is also active.
  // This is the ONLY source of tenant context — client-supplied values are ignored.
  const memberships = await db
    .select({
      organizationId: organizationMemberships.organizationId,
      orgRole: organizationMemberships.role,
      orgName: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(
      and(
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.status, 'active'),
        eq(organizations.status, 'active'),
      ),
    );

  let tenant: Tenant;
  let billing: Billing;

  if (memberships.length === 0) {
    // No active org membership → personal account
    tenant = { type: 'personal', organizationId: null, orgRole: null };
    billing = { accountOwnerType: 'user', accountOwnerId: user.id };
  } else if (memberships.length === 1) {
    // Exactly one active org membership → org billing
    const m = memberships[0];
    tenant = {
      type: 'organization',
      organizationId: m.organizationId,
      orgRole: m.orgRole,
    };
    billing = {
      accountOwnerType: 'organization',
      accountOwnerId: m.organizationId,
    };
  } else {
    // Multiple active org memberships → ambiguous, do NOT silently pick first
    throw new AmbiguousBillingError(
      memberships.map((m: { organizationId: string }) => m.organizationId),
    );
  }

  return { actor, tenant, billing };
}

/**
 * Resolve the unified request context from the server-side session.
 *
 * This is the PUBLIC entry point for API routes and server actions.
 * It calls resolveUser() to get the authenticated user (from session or
 * fingerprint), then resolves the full context.
 *
 * @param fingerprint - Optional fingerprint for non-auth-enabled mode
 * @returns The resolved context, or null if no authenticated user
 * @throws {AmbiguousBillingError} When user has multiple active org memberships
 */
export async function resolveContext(
  fingerprint?: string | null,
): Promise<RequestContext | null> {
  const user = await resolveUser(fingerprint);
  if (!user) return null;
  return resolveContextForUser(user);
}
