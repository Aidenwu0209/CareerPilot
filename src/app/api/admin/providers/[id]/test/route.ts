import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { decryptCredential } from '@/lib/crypto/credential-crypto';
import { db } from '@/lib/db';
import { aiProviders } from '@/lib/db/schema';
import { SSRF_SAFE_FETCH_OPTIONS, validateUpstreamUrl } from '@/lib/security/ssrf-guard';

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

function buildConnectionRequest(
  type: string,
  baseUrl: string,
  credential: string,
): { url: string; headers: Record<string, string> } {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${normalizedBaseUrl}/models`;

  if (type === 'anthropic') {
    return {
      url,
      headers: {
        'x-api-key': credential,
        'anthropic-version': '2023-06-01',
      },
    };
  }

  if (type === 'google') {
    return {
      url,
      headers: { 'x-goog-api-key': credential },
    };
  }

  return {
    url,
    headers: { Authorization: `Bearer ${credential}` },
  };
}

/**
 * POST /api/admin/providers/[id]/test
 *
 * Runs a bounded, read-only request against a controlled provider endpoint.
 * Credentials are decrypted only for the request and never returned or logged.
 */
export async function POST(
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
  const rows = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
  const provider = rows[0];

  if (!provider) {
    return NextResponse.json({ error: 'PROVIDER_NOT_FOUND' }, { status: 404 });
  }

  if (!provider.encryptedCredentials) {
    return NextResponse.json({ result: 'failed', error: 'NO_CREDENTIALS' });
  }

  const defaultBaseUrl = DEFAULT_BASE_URLS[provider.type];
  if (!defaultBaseUrl && !provider.baseUrl) {
    return NextResponse.json({ result: 'failed', error: 'UNSUPPORTED_PROVIDER' });
  }

  const baseUrl = provider.baseUrl || defaultBaseUrl;
  if (!baseUrl || !validateUpstreamUrl(baseUrl).ok) {
    return NextResponse.json({ result: 'failed', error: 'UPSTREAM_URL_NOT_ALLOWED' });
  }

  let result: 'success' | 'failed' = 'failed';
  let httpStatus: number | undefined;
  let error: string | undefined;

  try {
    const credential = decryptCredential(provider.encryptedCredentials);
    const target = buildConnectionRequest(provider.type, baseUrl, credential);
    const response = await fetch(target.url, {
      ...SSRF_SAFE_FETCH_OPTIONS,
      method: 'GET',
      headers: target.headers,
      signal: AbortSignal.timeout(10_000),
    });

    httpStatus = response.status;
    result = response.ok ? 'success' : 'failed';

    if (response.ok) {
      await db
        .update(aiProviders)
        .set({ lastValidatedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiProviders.id, id));
    }
  } catch {
    error = 'CONNECTION_ERROR';
  }

  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'provider.test',
    targetType: 'ai_provider',
    targetId: id,
    result: result === 'success' ? 'success' : 'failure',
    summary: `Tested provider '${provider.name}': ${result}`,
  });

  return NextResponse.json({
    result,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(error ? { error } : {}),
  });
}
