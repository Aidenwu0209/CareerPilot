import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { billingPlans, planModelAccess } from '@/lib/db/schema';
import { config } from '@/lib/config';

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  userLevel: z.string().regex(/^[a-z0-9_-]{2,50}$/).optional(),
  priceMinor: z.number().int().positive().optional(),
  credits: z.number().int().positive().optional(),
  billingInterval: z.enum(['month', 'year']).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  modelIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  if (ctx.context.actor.platformRole !== 'super_admin') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  const { id } = await params;
  const { modelIds, ...updates } = parsed.data;
  if (config.db.type === 'sqlite') {
    db.transaction((tx: typeof db) => {
      if (Object.keys(updates).length) tx.update(billingPlans).set({ ...updates, updatedAt: new Date() }).where(eq(billingPlans.id, id)).run();
      if (modelIds) {
        tx.delete(planModelAccess).where(eq(planModelAccess.planId, id)).run();
        if (modelIds.length) tx.insert(planModelAccess).values(modelIds.map((modelId) => ({ planId: id, modelId }))).run();
      }
    });
  } else {
    await db.transaction(async (tx: typeof db) => {
      if (Object.keys(updates).length) await tx.update(billingPlans).set({ ...updates, updatedAt: new Date() }).where(eq(billingPlans.id, id));
      if (modelIds) {
        await tx.delete(planModelAccess).where(eq(planModelAccess.planId, id));
        if (modelIds.length) await tx.insert(planModelAccess).values(modelIds.map((modelId) => ({ planId: id, modelId })));
      }
    });
  }
  return NextResponse.json({ ok: true });
}
