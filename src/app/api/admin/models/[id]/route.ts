import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { aiModels } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * PATCH /api/admin/models/[id]
 *
 * Super admin: update model fields.
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const model = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
  if (model.length === 0) {
    return NextResponse.json({ error: 'MODEL_NOT_FOUND' }, { status: 404 });
  }

  const updates: Partial<typeof aiModels.$inferInsert> = { updatedAt: new Date() };
  const changes: string[] = [];

  const allowedFields = [
    'displayName', 'capabilities', 'tier', 'status', 'visibility',
    'inputTokenLimit', 'outputTokenLimit', 'maxSteps',
    'fixedPrice', 'tokenPriceInput', 'tokenPriceOutput',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      // Validate non-negative prices
      if (['fixedPrice', 'tokenPriceInput', 'tokenPriceOutput', 'inputTokenLimit', 'outputTokenLimit', 'maxSteps'].includes(field)) {
        const val = body[field] as number;
        if (typeof val !== 'number' || val < 0) {
          return NextResponse.json({ error: `INVALID_${field.toUpperCase()}` }, { status: 400 });
        }
      }
      // Validate status/visibility enums
      if (field === 'status' && !['active', 'disabled'].includes(body[field] as string)) {
        return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
      }
      updates[field as keyof typeof updates] = body[field] as never;
      changes.push(`${field}=${body[field]}`);
    }
  }

  if (changes.length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 });
  }

  await db.update(aiModels).set(updates).where(eq(aiModels.id, id));

  await recordAuditEvent({
    actorId: ctx.context.actor.userId,
    action: 'model.update',
    targetType: 'ai_model',
    targetId: id,
    result: 'success',
    summary: `Updated model '${model[0].displayName}': ${changes.join(', ')}`,
  });

  const updated = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
  return NextResponse.json({ model: updated[0] });
}
