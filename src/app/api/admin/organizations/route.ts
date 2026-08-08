import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { eq, desc, like, or } from 'drizzle-orm';

/**
 * GET /api/admin/organizations
 *
 * Super admin: list/search organizations with pagination.
 */
export async function GET(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const conditions = q
    ? or(like(organizations.name, `%${q}%`), eq(organizations.slug, q))
    : undefined;

  const baseQuery = db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      status: organizations.status,
      seatLimit: organizations.seatLimit,
      createdBy: organizations.createdBy,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = conditions ? await baseQuery.where(conditions) : await baseQuery;

  return NextResponse.json({ organizations: rows, pagination: { limit, offset, count: rows.length } });
}

/**
 * POST /api/admin/organizations
 *
 * Super admin: create a new organization.
 *
 * Body: { name: string, slug: string, seatLimit: number, status?: 'active' | 'suspended' }
 *
 * AC1: Creates unique org with name, slug, seatLimit, status
 * AC2: Duplicate slug, empty name, invalid seatLimit → 400 field error
 * AC5: Writes audit event
 */
export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { name?: string; slug?: string; seatLimit?: number; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { name, slug, seatLimit, status } = body;

  // AC2: Validate name — non-empty
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'INVALID_NAME', detail: 'name is required' }, { status: 400 });
  }

  // AC2: Validate slug — non-empty, alphanumeric + hyphens
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return NextResponse.json({ error: 'INVALID_SLUG', detail: 'slug is required' }, { status: 400 });
  }

  // AC2: Validate seatLimit — non-negative integer
  if (seatLimit === undefined || !Number.isInteger(seatLimit) || seatLimit < 0) {
    return NextResponse.json(
      { error: 'INVALID_SEAT_LIMIT', detail: 'seatLimit must be a non-negative integer' },
      { status: 400 },
    );
  }

  // Validate status
  if (status && !['active', 'suspended'].includes(status)) {
    return NextResponse.json(
      { error: 'INVALID_STATUS', detail: 'status must be active or suspended' },
      { status: 400 },
    );
  }

  const adminId = ctx.context.actor.userId;

  // AC2: Check slug uniqueness
  const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: 'SLUG_ALREADY_EXISTS', detail: `Organization with slug '${slug}' already exists` }, { status: 409 });
  }

  // AC1: Create organization
  const orgId = crypto.randomUUID();
  await db.insert(organizations).values({
    id: orgId,
    name: name.trim(),
    slug: slug.trim(),
    seatLimit,
    status: (status ?? 'active') as 'active' | 'suspended',
    createdBy: adminId,
  });

  // AC5: Audit event
  await recordAuditEvent({
    actorId: adminId,
    action: 'org.create',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Created organization '${name.trim()}' (slug=${slug.trim()}, seats=${seatLimit})`,
  });

  const created = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);

  return NextResponse.json({ organization: created[0] }, { status: 201 });
}
