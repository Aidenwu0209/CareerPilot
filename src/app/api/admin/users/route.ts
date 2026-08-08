import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { users, creditAccounts, organizationMemberships, organizations } from '@/lib/db/schema';
import { eq, or, like, desc, sql, and } from 'drizzle-orm';

/**
 * GET /api/admin/users
 *
 * Super admin: search and list users with pagination.
 *
 * Query params:
 *   - q:       search by name or exact email
 *   - limit:   page size (default 50, max 100)
 *   - offset:  pagination offset (default 0)
 *
 * Returns: id, email, name, platformRole, status, balance, orgSummary, createdAt
 * Does NOT return: resumes, interview text, auth tokens, AI keys
 *
 * AC1: searchable by name or email, shows role/status/balance/org summary
 * AC2: non-super-admin → 403
 */
export async function GET(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  // AC2: Only super_admin can access
  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  // Build query — search by name OR exact email
  const conditions = q
    ? or(like(users.name, `%${q}%`), eq(users.email, q))
    : undefined;

  const baseQuery = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      platformRole: users.platformRole,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = conditions ? await baseQuery.where(conditions) : await baseQuery;

  // Enrich with balance and org summary
  const enriched = await Promise.all(
    rows.map(async (row: typeof rows[number]) => {
      // Personal credit account balance
      const acct = await db
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(
          and(
            eq(creditAccounts.ownerType, 'user'),
            eq(creditAccounts.ownerId, row.id),
          ),
        )
        .limit(1);

      // Active org memberships
      const memberships = await db
        .select({
          orgId: organizations.id,
          orgName: organizations.name,
          orgRole: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
        .where(
          and(
            eq(organizationMemberships.userId, row.id),
            eq(organizationMemberships.status, 'active'),
          ),
        );

      return {
        ...row,
        balance: acct[0]?.balance ?? 0,
        organizations: memberships,
      };
    }),
  );

  return NextResponse.json({ users: enriched, pagination: { limit, offset, count: enriched.length } });
}
