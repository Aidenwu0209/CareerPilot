import { AlertTriangle, Clock3, Coins, Gauge, ShieldCheck, Workflow } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { getOperationsDashboard } from '@/lib/admin/operations-dashboard';
import { OperationsTrendChart } from '@/components/admin/operations-trend-chart';

export default async function AdminOperationsPage() {
  const [dashboard, t, locale] = await Promise.all([
    getOperationsDashboard(),
    getTranslations('admin.operations'),
    getLocale(),
  ]);
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const cards = [
    { label: t('operations24h'), value: dashboard.summary.operations24h, icon: Workflow },
    { label: t('successRate24h'), value: `${dashboard.summary.successRate24h}%`, icon: ShieldCheck },
    { label: t('latency24h'), value: `${dashboard.summary.averageLatencyMs24h} ms`, icon: Clock3 },
    { label: t('credits30d'), value: dashboard.summary.netCredits30d, icon: Coins },
    { label: t('staleHolds'), value: dashboard.summary.staleHolds, icon: Gauge },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {dashboard.alerts.length > 0 && (
        <section aria-label={t('alerts')} className="space-y-2">
          {dashboard.alerts.map((alert) => (
            <div key={alert.code} className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{alert.message}</span>
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border bg-card p-5 shadow-sm">
            <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
            <div className="mt-4 text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {dashboard.summary.estimatedCost30d !== null && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          {t('estimatedCost', { cost: dashboard.summary.estimatedCost30d })}
        </div>
      )}

      <OperationsTrendChart data={dashboard.trends} locale={locale} />

      <div className="grid gap-6 xl:grid-cols-2">
        <DataTable title={t('topModels')} headers={[t('model'), t('calls'), t('failures')]}
          rows={dashboard.topModels.map((item) => [item.name, item.calls, item.failures])} empty={t('empty')} />
        <DataTable title={t('topUsers')} headers={[t('user'), t('calls')]}
          rows={dashboard.topUsers.map((item) => [item.label, item.calls])} empty={t('empty')} />
      </div>

      <DataTable title={t('recentAudit')} headers={[t('time'), t('action'), t('result'), t('summary')]}
        rows={dashboard.recentAudit.map((event) => [formatter.format(new Date(event.createdAt)), event.action, event.result, event.summary])}
        empty={t('empty')} />
    </div>
  );
}

function DataTable({ title, headers, rows, empty }: {
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  empty: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <h2 className="border-b px-5 py-4 font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-medium">{header}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-t">{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-md px-4 py-3">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
