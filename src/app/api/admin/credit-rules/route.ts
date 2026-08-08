import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { db } from '@/lib/db';
import { creditRules } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/admin/credit-rules
 *
 * Super admin: list all active credit rules.
 *
 * AC4: Returns current active rules (registration_grant, daily_limit_personal, daily_limit_org)
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const rules = await db
    .select()
    .from(creditRules)
    .where(eq(creditRules.active, true))
    .orderBy(desc(creditRules.ruleType));

  return NextResponse.json({ rules });
}

/**
 * PUT /api/admin/credit-rules
 *
 * Super admin: update a credit rule (creates a new version, deactivates old).
 *
 * Body: { ruleType: 'registration_grant' | 'daily_limit_personal' | 'daily_limit_org', value: number }
 *
 * AC4: Non-negative value; new version row; old rule deactivated; only affects future events
 */
export async function PUT(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  if (ctx.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { ruleType?: string; value?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const { ruleType, value } = body;

  const validRuleTypes = ['registration_grant', 'daily_limit_personal', 'daily_limit_org'] as const;
  if (!ruleType || !validRuleTypes.includes(ruleType as typeof validRuleTypes[number])) {
    return NextResponse.json(
      { error: 'INVALID_RULE_TYPE', detail: `ruleType must be one of: ${validRuleTypes.join(', ')}` },
      { status: 400 },
    );
  }

  // AC4: Non-negative integer
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    return NextResponse.json(
      { error: 'INVALID_VALUE', detail: 'value must be a non-negative integer' },
      { status: 400 },
    );
  }

  const adminId = ctx.context.actor.userId;

  // Find current active rule of this type
  const current = await db
    .select()
    .from(creditRules)
    .where(and(eq(creditRules.ruleType, ruleType as typeof validRuleTypes[number]), eq(creditRules.active, true)))
    .limit(1);

  const newVersion = current.length > 0 ? current[0].version + 1 : 1;
  const newRuleId = crypto.randomUUID();

  // Deactivate old active rule(s) of same type
  if (current.length > 0) {
    await db
      .update(creditRules)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(creditRules.ruleType, ruleType as typeof validRuleTypes[number]), eq(creditRules.active, true)));
  }

  // Insert new version
  await db.insert(creditRules).values({
    id: newRuleId,
    ruleType: ruleType as 'registration_grant' | 'daily_limit_personal' | 'daily_limit_org',
    value,
    version: newVersion,
    active: true,
    createdBy: adminId,
  });

  // Record audit event
  await recordAuditEvent({
    actorId: adminId,
    action: 'credit_rule.update',
    targetType: 'credit_rule',
    targetId: newRuleId,
    result: 'success',
    summary: `Updated rule ${ruleType} to value=${value} (v${newVersion})`,
  });

  return NextResponse.json({
    rule: {
      id: newRuleId,
      ruleType,
      value,
      version: newVersion,
      active: true,
    },
  });
}
