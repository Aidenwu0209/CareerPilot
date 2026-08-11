import { NextResponse } from 'next/server';
import { reconcileStripe } from '@/lib/billing/service';
import { dispatchAlert, resolveAlert } from '@/lib/observability/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const result = await reconcileStripe('cron:billing-reconciliation');
    if (result.issues.length > 0) {
      await dispatchAlert({
        fingerprint: 'billing:reconciliation-mismatch',
        source: 'billing-reconciliation',
        severity: 'critical',
        title: 'Payment reconciliation mismatch',
        message: `${result.issues.length} payment reconciliation issue(s) detected across ${result.checked} order(s).`,
        details: { runId: result.runId, issues: result.issues.slice(0, 20) },
      });
    } else {
      await resolveAlert('billing:reconciliation-mismatch');
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await dispatchAlert({
      fingerprint: 'billing:reconciliation-failed',
      source: 'billing-reconciliation',
      severity: 'critical',
      title: 'Payment reconciliation failed',
      message: error instanceof Error ? error.message : 'Unknown reconciliation failure',
    });
    return NextResponse.json({ error: 'RECONCILIATION_FAILED' }, { status: 500 });
  }
}
