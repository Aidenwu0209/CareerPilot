import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { rotateProviderCredential, CredentialCryptoError } from '@/lib/crypto/credential-crypto';

/**
 * POST /api/admin/providers/[id]/credentials/rotate
 *
 * Super admin: rotate a provider's API credential.
 *
 * Body: { newKey: string }
 *
 * AC3: Creates new version, encrypts, preserves status; never logs plaintext.
 */
export async function POST(
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

  let body: { newKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { newKey } = body;
  if (!newKey || typeof newKey !== 'string' || newKey.trim().length === 0) {
    return NextResponse.json({ error: 'NEW_KEY_REQUIRED' }, { status: 400 });
  }

  try {
    const result = rotateProviderCredential(id, newKey);

    // Audit — summary never includes plaintext
    await recordAuditEvent({
      actorId: ctx.context.actor.userId,
      action: 'provider.credential.rotate',
      targetType: 'ai_provider',
      targetId: id,
      result: 'success',
      summary: `Rotated credential for provider ${id} to version ${result.credentialVersion}`,
    });

    return NextResponse.json({
      providerId: id,
      credentialVersion: result.credentialVersion,
      maskedCredential: result.maskedCredential,
    });
  } catch (e) {
    if (e instanceof CredentialCryptoError) {
      const status = e.code === 'PROVIDER_NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: e.code, detail: e.message }, { status });
    }
    throw e;
  }
}
