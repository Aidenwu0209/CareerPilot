'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Membership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  joinedAt: Date | string;
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'REQUEST_FAILED');
  return data;
}

export function SchoolMembershipCard({ initialMembership }: { initialMembership: Membership | null }) {
  const zh = useLocale() === 'zh';
  const [membership, setMembership] = useState(initialMembership);
  const [invite, setInvite] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(action: () => Promise<Record<string, unknown>>) {
    setBusy(true);
    setMessage('');
    try {
      const result = await action();
      if (result.membership) setMembership(result.membership as Membership);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'REQUEST_FAILED');
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (membership) return (
    <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex items-center gap-3"><GraduationCap className="h-6 w-6 text-emerald-600" /><div>
        <h2 className="font-semibold">{zh ? '学校身份已绑定' : 'School membership connected'}</h2>
        <p className="text-sm text-muted-foreground">{membership.organizationName} · {membership.organizationSlug}</p>
      </div></div>
      <p className="mt-3 text-sm text-muted-foreground">{zh ? '符合条件的套餐会自动显示并结算学校专享价格。' : 'Eligible plans automatically display and charge the school price.'}</p>
    </section>
  );

  return (
    <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm dark:bg-zinc-900">
      <div className="flex items-center gap-2"><GraduationCap className="h-5 w-5 text-zinc-500" /><h2 className="font-semibold">{zh ? '绑定学校身份' : 'Connect a school membership'}</h2></div>
      <p className="mt-2 text-sm text-muted-foreground">{zh ? '使用学校邀请码，或验证已认证的学校邮箱。' : 'Use a school invite or verify an approved school email domain.'}</p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <form className="space-y-2" onSubmit={async (event) => {
          event.preventDefault();
          await run(async () => responseJson(await fetch('/api/schools/invite/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: invite }) })));
        }}>
          <label className="text-sm font-medium" htmlFor="school-invite">{zh ? '学校邀请码' : 'School invite code'}</label>
          <Input id="school-invite" value={invite} onChange={(event) => setInvite(event.target.value)} required />
          <Button type="submit" disabled={busy || !invite.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{zh ? '绑定' : 'Connect'}</Button>
        </form>
        <form className="space-y-2" onSubmit={async (event) => {
          event.preventDefault();
          if (!sent) {
            const result = await run(async () => responseJson(await fetch('/api/schools/email/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })));
            if (result) { setSent(true); setMessage(zh ? '验证码已发送' : 'Code sent'); }
            return;
          }
          await run(async () => responseJson(await fetch('/api/schools/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })));
        }}>
          <label className="text-sm font-medium" htmlFor="school-email">{zh ? '学校邮箱' : 'School email'}</label>
          <Input id="school-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setSent(false); }} required />
          {sent && <Input aria-label={zh ? '验证码' : 'Verification code'} inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} required />}
          <Button type="submit" disabled={busy || !email.trim() || (sent && code.length !== 6)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{sent ? (zh ? '验证并绑定' : 'Verify and connect') : (zh ? '发送验证码' : 'Send code')}</Button>
        </form>
      </div>
      {message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
