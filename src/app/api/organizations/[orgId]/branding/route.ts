import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { validateBranding, normalizeBranding, serializeBrandingForDatabase } from '@/lib/branding';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;
  const rows = await db.select({ branding: organizations.branding }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: 'ORGANIZATION_NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ branding: normalizeBranding(rows[0].branding) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;
  const validation = validateBranding(await request.json().catch(() => null));
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  await db.update(organizations)
    .set({
      branding: serializeBrandingForDatabase(validation.branding, config.db.type),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
  await recordAuditEvent({
    actorId: guard.adminId,
    tenantId: orgId,
    action: 'organization.branding.update',
    targetType: 'organization',
    targetId: orgId,
    result: 'success',
    summary: `Updated organization branding for ${orgId}`,
  });
  return NextResponse.json({ branding: validation.branding });
}
