import { NextResponse } from 'next/server';
import { getOperationsDashboard } from '@/lib/admin/operations-dashboard';
import { dispatchAlert, resolveAlert } from '@/lib/observability/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const dashboard = await getOperationsDashboard();
    const active = new Set(dashboard.alerts.map((alert) => `operations:${alert.code}`));
    const deliveries = await Promise.all(dashboard.alerts.map((alert) => dispatchAlert({
      fingerprint: `operations:${alert.code}`,
      source: 'operations-monitor',
      severity: alert.severity,
      title: alert.code.replaceAll('_', ' '),
      message: alert.message,
      details: dashboard.summary,
    })));
    for (const code of ['HIGH_FAILURE_RATE', 'HIGH_DAILY_CREDITS', 'STALE_CREDIT_HOLDS']) {
      const fingerprint = `operations:${code}`;
      if (!active.has(fingerprint)) await resolveAlert(fingerprint);
    }
    return NextResponse.json({ ok: true, generatedAt: dashboard.generatedAt, alerts: dashboard.alerts, deliveries });
  } catch (error) {
    await dispatchAlert({
      fingerprint: 'operations:monitor-failed',
      source: 'operations-monitor',
      severity: 'critical',
      title: 'Monitoring check failed',
      message: error instanceof Error ? error.message : 'Unknown monitoring failure',
    });
    return NextResponse.json({ error: 'MONITORING_CHECK_FAILED' }, { status: 500 });
  }
}
