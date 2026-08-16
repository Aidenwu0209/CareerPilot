import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { billingPlans, planModelAccess } from '@/lib/db/schema';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { config } from '@/lib/config';
import { logger } from '@/lib/observability/logger';

const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,50}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(''),
  kind: z.enum(['credit_pack', 'subscription']),
  userLevel: z.string().regex(/^[a-z0-9_-]{2,50}$/),
  priceMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).transform((v) => v.toLowerCase()),
  credits: z.number().int().nonnegative(),
  billingInterval: z.enum(['month', 'year']).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  modelIds: z.array(z.string().min(1)).default([]),
}).superRefine((value, ctx) => {
  if (value.kind === 'subscription' && !value.billingInterval) {
    ctx.addIssue({ code: 'custom', path: ['billingInterval'], message: 'Subscription interval required' });
  }
});

async function requireAdmin() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return { response: NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 }) };
  if (!ctx.ok) return { response: ctx.response };
  if (ctx.context.actor.platformRole !== 'super_admin') {
    return { response: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { context: ctx.context };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  const plans = await db.select().from(billingPlans).orderBy(asc(billingPlans.sortOrder));
  const access = await db.select().from(planModelAccess).where(eq(planModelAccess.enabled, true));
  return NextResponse.json({ plans: plans.map((plan: typeof billingPlans.$inferSelect) => ({
    ...plan,
    modelIds: access.filter((item: typeof planModelAccess.$inferSelect) => item.planId === plan.id).map((item: typeof planModelAccess.$inferSelect) => item.modelId),
  })) });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  const parsed = planSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 400 });
  const { modelIds, ...values } = parsed.data;
  const id = crypto.randomUUID();
  try {
    const planValues = { id, ...values, billingInterval: values.billingInterval ?? null };
    const accessValues = modelIds.map((modelId) => ({ planId: id, modelId }));
    if (config.db.type === 'sqlite') {
      db.transaction((tx: typeof db) => {
        tx.insert(billingPlans).values(planValues).run();
        if (accessValues.length) tx.insert(planModelAccess).values(accessValues).run();
      });
    } else {
      await db.transaction(async (tx: typeof db) => {
        await tx.insert(billingPlans).values(planValues);
        if (accessValues.length) await tx.insert(planModelAccess).values(accessValues);
      });
    }
  } catch (error) {
    logger.error('billing.admin_plan_creation_failed', { error, actorId: auth.context.actor.userId });
    return NextResponse.json({ error: 'PLAN_CREATE_FAILED' }, { status: 409 });
  }
  await recordAuditEvent({ actorId: auth.context.actor.userId, action: 'billing.plan.create', targetType: 'billing_plan', targetId: id, result: 'success', summary: `Created billing plan ${values.code}` });
  return NextResponse.json({ id }, { status: 201 });
}
