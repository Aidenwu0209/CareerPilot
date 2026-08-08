import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getUserIdFromRequest } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { DEFAULT_BRANDING, normalizeBranding } from '@/lib/branding';

export async function GET(request: Request) {
  const context = await resolveActiveContext(getUserIdFromRequest(request));
  if (context === null || !context.ok || context.context.tenant.type !== 'organization' || !context.context.tenant.organizationId) {
    return NextResponse.json({ branding: DEFAULT_BRANDING }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  }
  const rows = await db.select({ branding: organizations.branding })
    .from(organizations)
    .where(eq(organizations.id, context.context.tenant.organizationId))
    .limit(1);
  return NextResponse.json(
    { branding: normalizeBranding(rows[0]?.branding) },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
