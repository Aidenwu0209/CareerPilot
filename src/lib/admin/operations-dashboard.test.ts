import { describe, expect, it } from 'vitest';
import { buildOperationsDashboard } from './operations-dashboard';

describe('operations dashboard aggregation', () => {
  it('computes reliability, net consumption, rankings, cost and alerts', () => {
    const now = new Date('2026-08-08T12:00:00Z');
    const recent = new Date('2026-08-08T10:00:00Z');
    const dashboard = buildOperationsDashboard({
      now,
      operations: [
        { id: 'op1', actorId: 'u1', capability: 'chat', status: 'succeeded', createdAt: recent },
        { id: 'op2', actorId: 'u1', capability: 'photo', status: 'failed', createdAt: recent },
      ],
      attempts: [
        { operationId: 'op1', modelId: 'm1', status: 'succeeded', durationMs: 100, createdAt: recent },
        { operationId: 'op2', modelId: 'm1', status: 'failed', durationMs: 300, createdAt: recent },
      ],
      transactions: [
        { delta: -120, reason: 'consumption', businessRefId: 'op1', createdAt: recent },
        { delta: 20, reason: 'refund', businessRefId: 'op1', createdAt: recent },
      ],
      models: [{ id: 'm1', name: 'Managed Model' }],
      users: [{ id: 'u1', email: 'user@example.com', name: 'User One' }],
      staleHolds: 1,
      audits: [{ id: 'a1', action: 'credits.adjust', result: 'success', summary: 'Adjusted credits', createdAt: recent }],
      failureThresholdPercent: 10,
      dailyCreditThreshold: 80,
      costPerCredit: 0.02,
    });

    expect(dashboard.summary).toMatchObject({
      operations24h: 2,
      successRate24h: 50,
      averageLatencyMs24h: 200,
      netCredits30d: 100,
      estimatedCost30d: 2,
      staleHolds: 1,
    });
    expect(dashboard.topModels[0]).toMatchObject({ name: 'Managed Model', calls: 2, failures: 1 });
    expect(dashboard.topUsers[0]).toMatchObject({ label: 'User One', calls: 2 });
    expect(dashboard.alerts.map((alert) => alert.code)).toEqual(expect.arrayContaining([
      'HIGH_FAILURE_RATE', 'HIGH_DAILY_CREDITS', 'STALE_CREDIT_HOLDS',
    ]));
    expect(dashboard.recentAudit[0].summary).toBe('Adjusted credits');
  });
});
