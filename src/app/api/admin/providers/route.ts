import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { encryptCredential, maskCredential, getProviderCredentialInfo } from '@/lib/crypto/credential-crypto';
import { validateUpstreamUrl } from '@/lib/security/ssrf-guard';
import { db } from '@/lib/db';
import { aiProviders } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * GET /api/admin/providers
 *
 * Super admin: list all providers with masked credentials.
 *
 * AC3: Read response always contains only masked credentials.
 * AC4: Non-super-admin → 403.
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const providers = await db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt));

  const masked = providers.map((p: typeof providers[number]) =>
    getProviderCredentialInfo({
      id: p.id,
      type: p.type,
      name: p.name,
      status: p.status,
      baseUrl: p.baseUrl,
      encryptedCredentials: p.encryptedCredentials,
      credentialVersion: p.credentialVersion,
      lastValidatedAt: p.lastValidatedAt,
    }),
  );

  return NextResponse.json({ providers: masked });
}

/**
 * POST /api/admin/providers
 *
 * Super admin: create a new provider with encrypted credentials.
 *
 * Body: { type, name, baseUrl?, credential?, status? }
 *
 * AC1: Create provider and write encrypted credentials.
 * AC5: Custom baseUrl validated through US-023 SSRF guard.
 */
export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { type?: string; name?: string; baseUrl?: string; credential?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { type, name, baseUrl, credential, status } = body;

  if (!type || typeof type !== 'string') {
    return NextResponse.json({ error: 'TYPE_REQUIRED' }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'NAME_REQUIRED' }, { status: 400 });
  }

  // AC5: Validate baseUrl through SSRF guard if provided
  let validatedBaseUrl: string | null = null;
  if (baseUrl) {
    const urlCheck = validateUpstreamUrl(baseUrl);
    if (!urlCheck.ok) {
      return NextResponse.json({ error: 'UPSTREAM_URL_NOT_ALLOWED' }, { status: 400 });
    }
    validatedBaseUrl = baseUrl;
  }

  // Encrypt credential if provided
  let encryptedCred: string | null = null;
  if (credential) {
    encryptedCred = encryptCredential(credential);
  }

  const providerId = crypto.randomUUID();
  await db.insert(aiProviders).values({
    id: providerId,
    type: type.trim(),
    name: name.trim(),
    baseUrl: validatedBaseUrl,
    encryptedCredentials: encryptedCred,
    status: (status === 'disabled' ? 'disabled' : 'active'),
    credentialVersion: 1,
  });

  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'provider.create',
    targetType: 'ai_provider',
    targetId: providerId,
    result: 'success',
    summary: `Created provider '${name.trim()}' (type=${type.trim()})`,
  });

  const created = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
  const info = getProviderCredentialInfo({
    id: created[0].id,
    type: created[0].type,
    name: created[0].name,
    status: created[0].status,
    baseUrl: created[0].baseUrl,
    encryptedCredentials: created[0].encryptedCredentials,
    credentialVersion: created[0].credentialVersion,
    lastValidatedAt: created[0].lastValidatedAt,
  });

  return NextResponse.json({ provider: info }, { status: 201 });
}
