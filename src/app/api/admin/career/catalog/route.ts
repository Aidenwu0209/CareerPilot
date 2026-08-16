import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  applyCareerCatalog,
  dryRunCareerCatalog,
  rollbackCareerCatalog,
  stageCareerCatalog,
  type CareerCatalogBundle,
} from '@/lib/career/catalog-import';
import { logger } from '@/lib/observability/logger';

type CatalogAction =
  | { action: 'dry-run' | 'stage'; bundle: CareerCatalogBundle }
  | { action: 'apply' | 'rollback'; version: string };

export async function POST(request: Request) {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  if (context.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: CatalogAction;
  try {
    body = await request.json() as CatalogAction;
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  try {
    if (body.action === 'dry-run') {
      return NextResponse.json({ diff: await dryRunCareerCatalog(body.bundle) });
    }
    if (body.action === 'stage') {
      return NextResponse.json({ diff: await stageCareerCatalog(body.bundle), staged: true });
    }
    if ((body.action === 'apply' || body.action === 'rollback') && typeof body.version === 'string' && body.version) {
      if (body.action === 'apply') await applyCareerCatalog(body.version);
      else await rollbackCareerCatalog(body.version);
      return NextResponse.json({ version: body.version, active: true });
    }
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 });
  } catch (error) {
    logger.error('career.catalog_admin_action_failed', { error, actorId: context.context.actor.userId });
    return NextResponse.json({
      error: 'CATALOG_OPERATION_FAILED',
      message: error instanceof Error ? error.message : 'Catalog operation failed.',
    }, { status: 400 });
  }
}
