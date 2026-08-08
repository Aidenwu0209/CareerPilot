import { getTranslations } from 'next-intl/server';
import { resolveServerContext } from '@/lib/auth/server-context';
import { BrandingSettings } from '@/components/org-admin/branding-settings';

export default async function OrganizationBrandingPage() {
  const [context, t] = await Promise.all([resolveServerContext(), getTranslations('orgAdmin.branding')]);
  const orgId = context?.tenant.organizationId;
  if (!orgId) return null;
  return <div><h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1><p className="mb-6 mt-2 text-sm text-muted-foreground">{t('description')}</p><BrandingSettings orgId={orgId} /></div>;
}
