'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_BRANDING, type OrganizationBranding } from '@/lib/branding';

export function BrandingSettings({ orgId }: { orgId: string }) {
  const t = useTranslations('orgAdmin.branding');
  const [form, setForm] = useState<OrganizationBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`/api/organizations/${orgId}/branding`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setForm(data.branding))
      .catch(() => setMessage(t('loadError')))
      .finally(() => setLoading(false));
  }, [orgId, t]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/organizations/${orgId}/branding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error();
      setForm((await response.json()).branding);
      setMessage(t('saved'));
    } catch {
      setMessage(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;

  return (
    <form onSubmit={save} className="max-w-2xl space-y-6 rounded-xl border bg-card p-6 shadow-sm">
      <Field label={t('productName')} value={form.productName} maxLength={60}
        onChange={(productName) => setForm({ ...form, productName })} />
      <Field label={t('tagline')} value={form.tagline} maxLength={120}
        onChange={(tagline) => setForm({ ...form, tagline })} />
      <Field label={t('logoUrl')} value={form.logoUrl} maxLength={500} placeholder="https://example.com/logo.svg"
        onChange={(logoUrl) => setForm({ ...form, logoUrl })} />
      <div>
        <label className="text-sm font-medium" htmlFor="primaryColor">{t('primaryColor')}</label>
        <div className="mt-2 flex items-center gap-3">
          <input id="primaryColor" type="color" value={form.primaryColor || '#00A77F'}
            onChange={(event) => setForm({ ...form, primaryColor: event.target.value.toUpperCase() })}
            className="h-10 w-14 cursor-pointer rounded border bg-transparent p-1" />
          <Input value={form.primaryColor} placeholder="#00A77F" maxLength={7}
            onChange={(event) => setForm({ ...form, primaryColor: event.target.value.toUpperCase() })} />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/40 p-4" style={{ borderColor: form.primaryColor || undefined }}>
        <div className="font-semibold" style={{ color: form.primaryColor || undefined }}>{form.productName || 'CareerPilot'}</div>
        {form.tagline && <div className="mt-1 text-sm text-muted-foreground">{form.tagline}</div>}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? t('saving') : t('save')}</Button>
        {message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, ...props }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
}) {
  const id = label.replace(/\s+/g, '-');
  return <div><label className="text-sm font-medium" htmlFor={id}>{label}</label><Input id={id} className="mt-2" value={value} onChange={(event) => onChange(event.target.value)} {...props} /></div>;
}
