'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw } from 'lucide-react';

interface Model { id: string; displayName: string; family: string; capabilities: string[]; deliveryResolution: string; status: string }
interface Plan { id: string; code: string; name: string; kind: string; userLevel: string; priceMinor: number; currency: string; credits: number; active: boolean; modelIds: string[] }

export default function AdminBillingPage() {
  const zh = useLocale() === 'zh';
  const [plans, setPlans] = useState<Plan[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'credit_pack' | 'subscription'>('credit_pack');

  const load = useCallback(async () => {
    setLoading(true);
    const [plansResponse, modelsResponse] = await Promise.all([fetch('/api/admin/billing/plans'), fetch('/api/admin/models')]);
    if (plansResponse.ok) setPlans((await plansResponse.json()).plans);
    if (modelsResponse.ok) setModels((await modelsResponse.json()).models);
    setLoading(false);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setMessage('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = {
      code: String(form.get('code')), name: String(form.get('name')), description: String(form.get('description') || ''),
      kind, userLevel: String(form.get('userLevel')), priceMinor: Math.round(Number(form.get('price')) * 100),
      currency: String(form.get('currency')), credits: Number(form.get('credits')), billingInterval: kind === 'subscription' ? String(form.get('interval')) : null,
      active: true, sortOrder: plans.length, modelIds: selected,
    };
    const response = await fetch('/api/admin/billing/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    setMessage(response.ok ? (zh ? '套餐已创建。' : 'Plan created.') : `${zh ? '创建失败' : 'Create failed'}: ${data.error}`);
    if (response.ok) { formElement.reset(); setSelected([]); await load(); }
    setWorking(false);
  }

  async function toggle(plan: Plan) {
    await fetch(`/api/admin/billing/plans/${plan.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !plan.active }) });
    await load();
  }

  async function reconcile() {
    setWorking(true); setMessage('');
    const response = await fetch('/api/admin/billing/reconcile', { method: 'POST' });
    const data = await response.json();
    setMessage(response.ok ? `${zh ? '对账完成' : 'Reconciliation complete'}: ${data.checked} ${zh ? '笔，差异' : 'checked, mismatches'} ${data.issues.length}` : `${zh ? '对账失败' : 'Reconciliation failed'}: ${data.error}`);
    setWorking(false);
  }

  return <div className="space-y-8">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">{zh ? '支付、套餐与模型权限' : 'Billing, plans & model access'}</h1><p className="mt-2 text-sm text-muted-foreground">{zh ? '金额以人民币/指定币种最小单位结算；free 套餐可作为所有新用户的默认模型集合。' : 'Amounts are settled in minor currency units. Use plan code free as the default model set for new users.'}</p></div><Button variant="outline" onClick={() => void reconcile()} disabled={working}><RefreshCw className="mr-2 h-4 w-4" />{zh ? '立即对账' : 'Reconcile'}</Button></div>
    {message && <div className="rounded-lg bg-muted p-3 text-sm">{message}</div>}
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{zh ? '新建套餐' : 'Create plan'}</h2><form className="mt-4 space-y-4" onSubmit={create}>
      <div className="grid gap-3 md:grid-cols-3">{[['code', zh ? '代码（free 为默认级别）' : 'Code (free is default)', 'free'], ['name', zh ? '名称' : 'Name', 'Free'], ['userLevel', zh ? '用户等级' : 'User level', 'free'], ['price', zh ? '价格（元/主币种）' : 'Price (major unit)', '0'], ['credits', zh ? '到账点数' : 'Credits', '0'], ['currency', zh ? '币种' : 'Currency', 'cny']].map(([name, label, placeholder]) => <label key={name} className="text-sm"><span className="mb-1 block text-muted-foreground">{label}</span><input name={name} placeholder={placeholder} required className="h-10 w-full rounded-md border bg-background px-3" type={name === 'price' || name === 'credits' ? 'number' : 'text'} min={name === 'price' || name === 'credits' ? 0 : undefined} step={name === 'price' ? '0.01' : undefined} /></label>)}</div>
      <label className="block text-sm"><span className="mb-1 block text-muted-foreground">{zh ? '说明' : 'Description'}</span><input name="description" className="h-10 w-full rounded-md border bg-background px-3" /></label>
      <div className="flex flex-wrap gap-3"><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="credit_pack">{zh ? '充值包' : 'Credit pack'}</option><option value="subscription">{zh ? '订阅' : 'Subscription'}</option></select>{kind === 'subscription' && <select name="interval" className="h-10 rounded-md border bg-background px-3 text-sm"><option value="month">{zh ? '月付' : 'Monthly'}</option><option value="year">{zh ? '年付' : 'Yearly'}</option></select>}</div>
      <fieldset><legend className="mb-2 text-sm font-medium">{zh ? '允许使用的模型' : 'Allowed models'}</legend><div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-3 md:grid-cols-2">{models.map((model) => <label key={model.id} className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-muted"><input type="checkbox" checked={selected.includes(model.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, model.id] : current.filter((id) => id !== model.id))} /><span>{model.displayName}</span><Badge variant="outline" className="ml-auto">{model.family || 'other'} {model.deliveryResolution !== 'native' ? model.deliveryResolution : ''}</Badge></label>)}</div></fieldset>
      <Button type="submit" disabled={working}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{zh ? '创建并发布' : 'Create & publish'}</Button>
    </form></section>
    <section className="overflow-hidden rounded-xl border bg-card"><h2 className="border-b px-5 py-4 font-semibold">{zh ? '现有套餐' : 'Existing plans'}</h2>{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin" /></div> : <div className="divide-y">{plans.map((plan) => <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"><div><span className="font-medium">{plan.name}</span><span className="ml-2 text-muted-foreground">{plan.code} · {plan.userLevel} · {(plan.priceMinor / 100).toFixed(2)} {plan.currency.toUpperCase()} · {plan.credits} credits · {plan.modelIds.length} models</span></div><div className="flex items-center gap-2"><Badge variant={plan.active ? 'default' : 'secondary'}>{plan.active ? (zh ? '已发布' : 'Active') : (zh ? '已停用' : 'Disabled')}</Badge><Button size="sm" variant="outline" onClick={() => void toggle(plan)}>{plan.active ? (zh ? '停用' : 'Disable') : (zh ? '启用' : 'Enable')}</Button></div></div>)}</div>}</section>
  </div>;
}
