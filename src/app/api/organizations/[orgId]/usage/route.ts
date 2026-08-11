import { NextRequest, NextResponse } from 'next/server';
import { resolveOrgAdmin } from '@/lib/auth/org-guard';
import { getOrCreateAccount } from '@/lib/credits/ledger';
import { db } from '@/lib/db';
import {
  aiOperations,
  aiProviderAttempts,
  aiModels,
  creditTransactions,
  users,
} from '@/lib/db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;

  const guard = await resolveOrgAdmin(orgId);
  if (!guard.ok) return guard.response;

  const account = await getOrCreateAccount('organization', orgId);

  const url = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'INVALID_TIME_RANGE' }, { status: 400 });
  }

  const consumptionRows = await db
    .select({
      totalConsumed: sql<number>`COALESCE(SUM(ABS(${creditTransactions.delta})), 0)`,
      transactionCount: sql<number>`COUNT(*)`,
    })
    .from(creditTransactions)
    .where(and(
      eq(creditTransactions.accountId, account.id),
      eq(creditTransactions.reason, 'consumption'),
      gte(creditTransactions.createdAt, from),
      lte(creditTransactions.createdAt, to),
    ));

  const totalConsumed = Number(consumptionRows[0]?.totalConsumed ?? 0);
  const transactionCount = Number(consumptionRows[0]?.transactionCount ?? 0);

  const memberUsage = await db
    .select({
      userId: aiOperations.actorId,
      opCount: sql<number>`COUNT(*)`,
      succeeded: sql<number>`SUM(CASE WHEN ${aiOperations.status} = 'succeeded' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${aiOperations.status} = 'failed' THEN 1 ELSE 0 END)`,
      email: users.email,
      name: users.name,
    })
    .from(aiOperations)
    .leftJoin(users, eq(users.id, aiOperations.actorId))
    .where(and(
      eq(aiOperations.billingAccountId, account.id),
      gte(aiOperations.createdAt, from),
      lte(aiOperations.createdAt, to),
    ))
    .groupBy(aiOperations.actorId)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit)
    .offset(offset);

  const modelUsage = await db
    .select({
      modelId: aiProviderAttempts.modelId,
      attemptCount: sql<number>`COUNT(*)`,
      succeeded: sql<number>`SUM(CASE WHEN ${aiProviderAttempts.status} = 'succeeded' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${aiProviderAttempts.status} = 'failed' THEN 1 ELSE 0 END)`,
      displayName: aiModels.displayName,
    })
    .from(aiProviderAttempts)
    .innerJoin(aiOperations, eq(aiOperations.id, aiProviderAttempts.operationId))
    .leftJoin(aiModels, eq(aiModels.id, aiProviderAttempts.modelId))
    .where(and(
      eq(aiOperations.billingAccountId, account.id),
      gte(aiOperations.createdAt, from),
      lte(aiOperations.createdAt, to),
    ))
    .groupBy(aiProviderAttempts.modelId)
    .orderBy(desc(sql`COUNT(*)`));

  return NextResponse.json({
    summary: {
      totalConsumed,
      totalOperations: transactionCount,
      remainingBalance: account.balance,
      period: { from: from.toISOString(), to: to.toISOString() },
    },
    byMember: memberUsage.map((m: typeof memberUsage[number]) => ({
      userId: m.userId, email: m.email, name: m.name,
      operations: Number(m.opCount), succeeded: Number(m.succeeded), failed: Number(m.failed),
    })),
    byModel: modelUsage.map((m: typeof modelUsage[number]) => ({
      modelId: m.modelId, displayName: m.displayName,
      attempts: Number(m.attemptCount), succeeded: Number(m.succeeded), failed: Number(m.failed),
    })),
    pagination: { limit, offset },
  });
}
