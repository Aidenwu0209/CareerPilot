import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { getProviderCredentialInfo } from '@/lib/crypto/credential-crypto';
import { validateUpstreamUrl } from '@/lib/security/ssrf-guard';
import { db } from '@/lib/db';
import { aiProviders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/admin/providers/[id]
 *
 * Super admin: view provider detail with masked credentials.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;
  const provider = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
  if (provider.length === 0) {
    return NextResponse.json({ error: 'PROVIDER_NOT_FOUND' }, { status: 404 });
  }

  const info = getProviderCredentialInfo({
    id: provider[0].id,
    type: provider[0].type,
    name: provider[0].name,
    status: provider[0].status,
    baseUrl: provider[0].baseUrl,
    encryptedCredentials: provider[0].encryptedCredentials,
    credentialVersion: provider[0].credentialVersion,
    lastValidatedAt: provider[0].lastValidatedAt,
  });

  return NextResponse.json({ provider: info });
}

/**
 * PATCH /api/admin/providers/[id]
 *
 * Super admin: update provider name, status, or baseUrl.
 *
 * AC3: Enable/disable writes audit event.
 * AC5: Custom baseUrl validated through SSRF guard.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;

  let body: { name?: string; status?: string; baseUrl?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const provider = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
  if (provider.length === 0) {
    return NextResponse.json({ error: 'PROVIDER_NOT_FOUND' }, { status: 404 });
  }

  const updates: Partial<typeof aiProviders.$inferInsert> = { updatedAt: new Date() };
  const changes: string[] = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'INVALID_NAME' }, { status: 400 });
    }
    updates.name = body.name.trim();
    changes.push(`name='${body.name.trim()}'`);
  }

  if (body.status !== undefined) {
    if (!['active', 'disabled'].includes(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
    }
    updates.status = body.status as 'active' | 'disabled';
    changes.push(`status=${body.status}`);
  }

  if (body.baseUrl !== undefined) {
    if (body.baseUrl === null || body.baseUrl === '') {
      updates.baseUrl = null;
      changes.push('baseUrl=null');
    } else {
      // AC5: Validate through SSRF guard
      const urlCheck = validateUpstreamUrl(body.baseUrl);
      if (!urlCheck.ok) {
        return NextResponse.json({ error: 'UPSTREAM_URL_NOT_ALLOWED' }, { status: 400 });
      }
      updates.baseUrl = body.baseUrl;
      changes.push(`baseUrl=${body.baseUrl}`);
    }
  }

  if (changes.length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }

  await db.update(aiProviders).set(updates).where(eq(aiProviders.id, id));

  // AC3: Audit event for status changes
  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'provider.update',
    targetType: 'ai_provider',
    targetId: id,
    result: 'success',
    summary: `Updated provider '${provider[0].name}': ${changes.join(', ')}`,
  });

  const updated = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
  const info = getProviderCredentialInfo({
    id: updated[0].id,
    type: updated[0].type,
    name: updated[0].name,
    status: updated[0].status,
    baseUrl: updated[0].baseUrl,
    encryptedCredentials: updated[0].encryptedCredentials,
    credentialVersion: updated[0].credentialVersion,
    lastValidatedAt: updated[0].lastValidatedAt,
  });

  return NextResponse.json({ provider: info });
}
