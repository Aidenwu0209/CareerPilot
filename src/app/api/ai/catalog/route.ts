import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getUserCatalog } from '@/lib/ai/model-catalog';

/**
 * GET /api/ai/catalog
 *
 * User-facing model catalog.
 *
 * AC3: Returns only enabled + public models from active providers.
 * AC4: Response excludes provider keys, internal URLs, and encrypted credentials.
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const models = await getUserCatalog();

  return NextResponse.json({ models });
}
