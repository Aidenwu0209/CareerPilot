import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  aiModels,
  aiOperations,
  aiProviderAttempts,
  auditEvents,
  creditHolds,
  creditTransactions,
  users,
} from '@/lib/db/schema';

interface OperationRow {
  id: string;
  actorId: string;
  capability: string;
  status: string;
  createdAt: Date;
}

interface AttemptRow {
  operationId: string;
  modelId: string;
  status: string;
  durationMs: number | null;
  createdAt: Date;
}

interface TransactionRow {
  delta: number;
  reason: string;
  businessRefId: string | null;
  createdAt: Date;
}

export interface OperationsDashboard {
  generatedAt: string;
  summary: {
    operations24h: number;
    successRate24h: number;
    averageLatencyMs24h: number;
    netCredits30d: number;
    estimatedCost30d: number | null;
    staleHolds: number;
  };
  alerts: Array<{ severity: 'warning' | 'critical'; code: string; message: string }>;
  topModels: Array<{ id: string; name: string; calls: number; failures: number }>;
  topUsers: Array<{ id: string; label: string; calls: number }>;
  recentAudit: Array<{
    id: string;
    action: string;
    result: string;
    summary: string;
    createdAt: string;
  }>;
}

export async function getOperationsDashboard(): Promise<OperationsDashboard> {
  const now = new Date();
  const [operations, attempts, transactions, models, userRows, holds, audits] = await Promise.all([
    db.select().from(aiOperations).orderBy(desc(aiOperations.createdAt)).limit(2_000),
    db.select().from(aiProviderAttempts).orderBy(desc(aiProviderAttempts.createdAt)).limit(4_000),
    db.select().from(creditTransactions).orderBy(desc(creditTransactions.createdAt)).limit(4_000),
    db.select({ id: aiModels.id, name: aiModels.displayName }).from(aiModels),
    db.select({ id: users.id, email: users.email, name: users.name }).from(users),
    db.select({ status: creditHolds.status, expiresAt: creditHolds.expiresAt }).from(creditHolds),
    db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(50),
  ]);

  return buildOperationsDashboard({
    operations,
    attempts,
    transactions,
    models,
    users: userRows,
    staleHolds: holds.filter((hold: { status: string; expiresAt: Date }) =>
      hold.status === 'active' && hold.expiresAt <= now,
    ).length,
    audits,
    now,
    failureThresholdPercent: readNonNegativeNumber('OPS_ALERT_FAILURE_RATE_PERCENT', 10),
    dailyCreditThreshold: readNonNegativeNumber('OPS_ALERT_DAILY_CREDITS', 10_000),
    costPerCredit: readOptionalNonNegativeNumber('AI_COST_PER_CREDIT'),
  });
}

export function buildOperationsDashboard(input: {
  operations: OperationRow[];
  attempts: AttemptRow[];
  transactions: TransactionRow[];
  models: Array<{ id: string; name: string }>;
  users: Array<{ id: string; email: string | null; name: string | null }>;
  staleHolds: number;
  audits: Array<{ id: string; action: string; result: string; summary: string; createdAt: Date }>;
  now: Date;
  failureThresholdPercent: number;
  dailyCreditThreshold: number;
  costPerCredit: number | null;
}): OperationsDashboard {
  const since24h = input.now.getTime() - 24 * 60 * 60 * 1000;
  const since30d = input.now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const operations24h = input.operations.filter((row) => row.createdAt.getTime() >= since24h);
  const finished24h = operations24h.filter((row) => ['succeeded', 'failed', 'cancelled'].includes(row.status));
  const succeeded24h = finished24h.filter((row) => row.status === 'succeeded').length;
  const successRate24h = finished24h.length === 0 ? 100 : Math.round((succeeded24h / finished24h.length) * 1000) / 10;
  const attempts24h = input.attempts.filter((row) => row.createdAt.getTime() >= since24h && row.durationMs !== null);
  const averageLatencyMs24h = attempts24h.length === 0
    ? 0
    : Math.round(attempts24h.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / attempts24h.length);

  const ledger30d = input.transactions.filter((row) =>
    row.createdAt.getTime() >= since30d && row.businessRefId && ['consumption', 'refund'].includes(row.reason),
  );
  const netCredits30d = Math.max(0, -ledger30d.reduce((sum, row) => sum + row.delta, 0));
  const credits24h = Math.max(0, -input.transactions
    .filter((row) => row.createdAt.getTime() >= since24h && row.businessRefId && ['consumption', 'refund'].includes(row.reason))
    .reduce((sum, row) => sum + row.delta, 0));

  const modelNames = new Map(input.models.map((model) => [model.id, model.name]));
  const modelStats = new Map<string, { calls: number; failures: number }>();
  for (const attempt of input.attempts.filter((row) => row.createdAt.getTime() >= since30d)) {
    const current = modelStats.get(attempt.modelId) ?? { calls: 0, failures: 0 };
    current.calls += 1;
    if (['failed', 'timeout'].includes(attempt.status)) current.failures += 1;
    modelStats.set(attempt.modelId, current);
  }

  const userLabels = new Map(input.users.map((user) => [user.id, user.name || user.email || user.id]));
  const userStats = new Map<string, number>();
  for (const operation of input.operations.filter((row) => row.createdAt.getTime() >= since30d)) {
    userStats.set(operation.actorId, (userStats.get(operation.actorId) ?? 0) + 1);
  }

  const alerts: OperationsDashboard['alerts'] = [];
  const failureRate = 100 - successRate24h;
  if (finished24h.length > 0 && failureRate >= input.failureThresholdPercent) {
    alerts.push({
      severity: failureRate >= input.failureThresholdPercent * 2 ? 'critical' : 'warning',
      code: 'HIGH_FAILURE_RATE',
      message: `24h AI failure rate is ${failureRate.toFixed(1)}%.`,
    });
  }
  if (credits24h >= input.dailyCreditThreshold) {
    alerts.push({ severity: 'warning', code: 'HIGH_DAILY_CREDITS', message: `24h net AI consumption reached ${credits24h} credits.` });
  }
  if (input.staleHolds > 0) {
    alerts.push({ severity: 'warning', code: 'STALE_CREDIT_HOLDS', message: `${input.staleHolds} expired credit hold(s) still require settlement or release.` });
  }

  return {
    generatedAt: input.now.toISOString(),
    summary: {
      operations24h: operations24h.length,
      successRate24h,
      averageLatencyMs24h,
      netCredits30d,
      estimatedCost30d: input.costPerCredit === null ? null : Math.round(netCredits30d * input.costPerCredit * 100) / 100,
      staleHolds: input.staleHolds,
    },
    alerts,
    topModels: [...modelStats.entries()]
      .map(([id, stats]) => ({ id, name: modelNames.get(id) ?? id, ...stats }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8),
    topUsers: [...userStats.entries()]
      .map(([id, calls]) => ({ id, label: userLabels.get(id) ?? id, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8),
    recentAudit: input.audits.slice(0, 20).map((event) => ({
      id: event.id,
      action: event.action,
      result: event.result,
      summary: event.summary,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

function readNonNegativeNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readOptionalNonNegativeNumber(name: string): number | null {
  if (!process.env[name]) return null;
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
