'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

interface Plan { id: string; name: string; description: string; kind: 'credit_pack' | 'subscription'; userLevel: string; priceMinor: number; currency: string; credits: number; billingInterval: 'month' | 'year' | null }
interface OrderRow { order: { id: string; status: string; amountMinor: number; currency: string; credits: number; paidAt: string | null; createdAt: string }; planName: string; planCode: string }
interface Subscription { entitlement: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }; plan: { name: string; userLevel: string } }

export function BillingPanel({ personalAccount }: { personalAccount: boolean }) {
  const locale = useLocale();
  const zh = locale === 'zh';
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [plansRes, ordersRes, subscriptionRes] = await Promise.all([fetch('/api/billing/plans'), fetch('/api/billing/orders'), fetch('/api/billing/subscription')]);
    if (plansRes.ok) setPlans((await plansRes.json()).plans);
    if (ordersRes.ok) setOrders((await ordersRes.json()).orders);
    if (subscriptionRes.ok) setSubscription((await subscriptionRes.json()).subscription);
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [authLoading, isAuthenticated, load]);

  async function checkout(planId: string) {
    setWorking(planId); setMessage(null);
    const response = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ planId, locale }),
    });
    const data = await response.json();
    if (response.ok && data.checkoutUrl) window.location.assign(data.checkoutUrl);
    else setMessage(zh ? `无法发起支付：${data.error ?? '未知错误'}` : `Unable to start payment: ${data.error ?? 'Unknown error'}`);
    setWorking(null);
  }

  async function refund(orderId: string) {
    if (!window.confirm(zh ? '退款会同步扣回对应点数，确定继续吗？' : 'The matching credits will be reversed. Continue?')) return;
    setWorking(orderId); setMessage(null);
    const response = await fetch('/api/billing/refunds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }),
    });
    const data = await response.json();
    setMessage(response.ok ? (zh ? '退款申请已提交。' : 'Refund submitted.') : (zh ? `退款失败：${data.error}` : `Refund failed: ${data.error}`));
    await load(); setWorking(null);
  }

  async function openPortal() {
    setWorking('portal');
    const response = await fetch('/api/billing/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) });
    const data = await response.json();
    if (response.ok) window.location.assign(data.url);
    else setMessage(zh ? `无法打开订阅管理：${data.error}` : `Unable to open subscription portal: ${data.error}`);
    setWorking(null);
  }

  const money = (minor: number, currency: string) => new Intl.NumberFormat(zh ? 'zh-CN' : 'en-US', { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100);
  if (!personalAccount) return null;
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div><h2 className="font-semibold">{zh ? '充值与套餐' : 'Top-ups & plans'}</h2><p className="mt-1 text-sm text-muted-foreground">{zh ? '安全支付、自动到账；套餐等级决定可使用的模型。' : 'Secure checkout and automatic credit delivery. Your plan controls model access.'}</p></div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {message && <div className="rounded-lg bg-muted px-3 py-2 text-sm">{message}</div>}
      {subscription && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm"><div><span className="font-medium">{subscription.plan.name}</span><span className="ml-2 text-muted-foreground">{subscription.plan.userLevel} · {subscription.entitlement.status}{subscription.entitlement.cancelAtPeriodEnd ? (zh ? ' · 到期后取消' : ' · cancels at period end') : ''}</span></div><Button size="sm" variant="outline" onClick={() => void openPortal()} disabled={working !== null}>{zh ? '管理订阅' : 'Manage subscription'}</Button></div>}
      {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : plans.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{zh ? '管理员尚未发布可购买套餐。' : 'No purchasable plans have been published yet.'}</p>
      ) : <div className="grid gap-3 md:grid-cols-3">{plans.map((plan) => (
        <article key={plan.id} className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-2"><h3 className="font-medium">{plan.name}</h3><Badge variant="secondary">{plan.userLevel}</Badge></div>
          <p className="mt-2 min-h-10 text-xs text-muted-foreground">{plan.description}</p>
          <div className="mt-4 text-2xl font-semibold">{money(plan.priceMinor, plan.currency)}{plan.kind === 'subscription' && <span className="text-xs font-normal text-muted-foreground">/{plan.billingInterval === 'year' ? (zh ? '年' : 'year') : (zh ? '月' : 'month')}</span>}</div>
          <p className="mt-1 text-sm text-muted-foreground">{plan.credits.toLocaleString()} {zh ? '点数' : 'credits'}</p>
          <Button className="mt-4 w-full" onClick={() => void checkout(plan.id)} disabled={working !== null}><CreditCard className="mr-2 h-4 w-4" />{working === plan.id ? (zh ? '正在跳转…' : 'Redirecting…') : (zh ? '购买' : 'Buy')}</Button>
        </article>
      ))}</div>}
      {orders.length > 0 && <div className="pt-3"><h3 className="mb-2 text-sm font-medium">{zh ? '支付与退款记录' : 'Payments & refunds'}</h3><div className="divide-y rounded-lg border">{orders.slice(0, 10).map(({ order, planName }) => (
        <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
          <div><span className="font-medium">{planName}</span><span className="ml-2 text-muted-foreground">{money(order.amountMinor, order.currency)} · {order.credits} {zh ? '点' : 'credits'}</span></div>
          <div className="flex items-center gap-2"><Badge variant="outline">{order.status}</Badge>{['paid', 'partially_refunded'].includes(order.status) && <Button variant="ghost" size="sm" onClick={() => void refund(order.id)} disabled={working !== null}>{zh ? '申请退款' : 'Refund'}</Button>}</div>
        </div>
      ))}</div></div>}
    </section>
  );
}
