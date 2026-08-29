'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Settings {
  domains: Array<{ id: string; domain: string; verified: boolean }>;
  invites: Array<{ id: string; codePrefix: string; useCount: number; maxUses: number | null; expiresAt: string | null; active: boolean }>;
  discounts: Array<{ id: string; planCode: string; percentOff: number; active: boolean }>;
  plaintextCode?: string;
}

async function asJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
  return body as Settings;
}

export function SchoolSettings({ orgId }: { orgId: string }) {
  const zh = useLocale() === 'zh';
  const [data, setData] = useState<Settings | null>(null);
  const [domain, setDomain] = useState('');
  const [maxUses, setMaxUses] = useState('100');
  const [planCode, setPlanCode] = useState('*');
  const [percentOff, setPercentOff] = useState('20');
  const [newCode, setNewCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await asJson(await fetch(`/api/organizations/${orgId}/school-settings`))); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED'); }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  async function create(body: Record<string, unknown>) {
    setBusy(true); setMessage('');
    try {
      const next = await asJson(await fetch(`/api/organizations/${orgId}/school-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      setData(next);
      if (next.plaintextCode) setNewCode(next.plaintextCode);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED'); }
    finally { setBusy(false); }
  }

  async function deactivate(resource: 'domain' | 'invite' | 'discount', id: string) {
    setBusy(true);
    try { setData(await asJson(await fetch(`/api/organizations/${orgId}/school-settings`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource, id }) }))); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED'); }
    finally { setBusy(false); }
  }

  if (!data) return <p className="text-sm text-muted-foreground">{message || (zh ? '正在加载…' : 'Loading…')}</p>;
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold">{zh ? '学校合作设置' : 'School partnership settings'}</h1><p className="mt-1 text-sm text-muted-foreground">{zh ? '管理学校域名、学生邀请码和套餐优惠。新域名需平台管理员核验后才能用于邮箱绑定。' : 'Manage school domains, student invites, and plan discounts. New domains require platform verification.'}</p></header>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{zh ? '认证域名' : 'Approved domains'}</h2>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void create({ action: 'add_domain', domain }); setDomain(''); }}><Input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="university.edu" required /><Button disabled={busy}>{zh ? '添加' : 'Add'}</Button></form>
      <div className="mt-4 space-y-2">{data.domains.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><span>{item.domain} <Badge variant={item.verified ? 'default' : 'secondary'}>{item.verified ? (zh ? '已认证' : 'Verified') : (zh ? '待认证' : 'Pending')}</Badge></span><Button size="sm" variant="ghost" onClick={() => deactivate('domain', item.id)}>{zh ? '移除' : 'Remove'}</Button></div>)}</div>
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{zh ? '学生邀请码' : 'Student invite codes'}</h2>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setNewCode(''); void create({ action: 'create_invite', maxUses: Number(maxUses) }); }}><Input type="number" min="1" max="100000" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /><Button disabled={busy}>{zh ? '生成邀请码' : 'Create invite'}</Button></form>
      {newCode && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><strong>{newCode}</strong><p className="text-muted-foreground">{zh ? '明文只显示这一次，请立即安全保存。' : 'The plaintext is shown once. Store it securely now.'}</p></div>}
      <div className="mt-4 space-y-2">{data.invites.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><span className="font-mono text-sm">{item.codePrefix}… · {item.useCount}/{item.maxUses ?? '∞'} · {item.active ? (zh ? '有效' : 'active') : (zh ? '停用' : 'inactive')}</span>{item.active && <Button size="sm" variant="ghost" onClick={() => deactivate('invite', item.id)}>{zh ? '停用' : 'Disable'}</Button>}</div>)}</div>
    </section>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">{zh ? '学校套餐优惠' : 'School plan discounts'}</h2>
      <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_160px_auto]" onSubmit={(event) => { event.preventDefault(); void create({ action: 'upsert_discount', planCode, percentOff: Number(percentOff) }); }}><Input value={planCode} onChange={(event) => setPlanCode(event.target.value)} placeholder="*" /><Input type="number" min="1" max="90" value={percentOff} onChange={(event) => setPercentOff(event.target.value)} /><Button disabled={busy}>{zh ? '保存优惠' : 'Save discount'}</Button></form>
      <div className="mt-4 space-y-2">{data.discounts.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border p-3"><span>{item.planCode} · {item.percentOff}% {zh ? '优惠' : 'off'}</span>{item.active && <Button size="sm" variant="ghost" onClick={() => deactivate('discount', item.id)}>{zh ? '停用' : 'Disable'}</Button>}</div>)}</div>
    </section>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
  </div>;
}
