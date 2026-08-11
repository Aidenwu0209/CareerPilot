import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { aiProviders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getProviderCredentialInfo } from '@/lib/crypto/credential-crypto';

/**
 * GET /api/admin/providers/[id]/credentials
 *
 * Super admin: view masked credential info for a provider.
 *
 * AC4: Returns only masked key, version, and last-validated metadata.
 * Never returns plaintext credentials.
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

  return NextResponse.json({ credential: info });
}
