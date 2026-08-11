export interface OrganizationBranding {
  productName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
}

export const DEFAULT_BRANDING: OrganizationBranding = {
  productName: 'CareerPilot',
  tagline: '',
  logoUrl: '',
  primaryColor: '',
};

export function normalizeBranding(value: unknown): OrganizationBranding {
  if (!value) return { ...DEFAULT_BRANDING };
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { ...DEFAULT_BRANDING }; }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_BRANDING };
  }
  const raw = parsed as Record<string, unknown>;
  return {
    productName: validText(raw.productName, 60) || DEFAULT_BRANDING.productName,
    tagline: validText(raw.tagline, 120),
    logoUrl: validLogoUrl(raw.logoUrl),
    primaryColor: validColor(raw.primaryColor),
  };
}

export function validateBranding(value: unknown):
  | { ok: true; branding: OrganizationBranding }
  | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'INVALID_BRANDING' };
  }
  const raw = value as Record<string, unknown>;
  if (raw.productName !== undefined && (!validText(raw.productName, 60) || String(raw.productName).trim().length < 2)) {
    return { ok: false, error: 'INVALID_PRODUCT_NAME' };
  }
  if (raw.tagline !== undefined && typeof raw.tagline !== 'string') {
    return { ok: false, error: 'INVALID_TAGLINE' };
  }
  if (typeof raw.tagline === 'string' && raw.tagline.trim().length > 120) {
    return { ok: false, error: 'INVALID_TAGLINE' };
  }
  if (raw.logoUrl !== undefined && typeof raw.logoUrl !== 'string') {
    return { ok: false, error: 'INVALID_LOGO_URL' };
  }
  if (typeof raw.logoUrl === 'string' && raw.logoUrl.trim() && !validLogoUrl(raw.logoUrl)) {
    return { ok: false, error: 'INVALID_LOGO_URL' };
  }
  if (raw.primaryColor !== undefined && typeof raw.primaryColor !== 'string') {
    return { ok: false, error: 'INVALID_PRIMARY_COLOR' };
  }
  if (typeof raw.primaryColor === 'string' && raw.primaryColor.trim() && !validColor(raw.primaryColor)) {
    return { ok: false, error: 'INVALID_PRIMARY_COLOR' };
  }
  return { ok: true, branding: normalizeBranding(raw) };
}

/** SQLite's JSON-mode text column serializes objects for us; PostgreSQL's
 * plain text column needs the JSON encoding explicitly. */
export function serializeBrandingForDatabase(
  branding: OrganizationBranding,
  databaseType: 'sqlite' | 'postgresql',
): OrganizationBranding | string {
  return databaseType === 'postgresql' ? JSON.stringify(branding) : branding;
}

function validText(value: unknown, max: number): string {
  return typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
}

function validColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : '';
}

function validLogoUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) return '';
  if (/^\/[A-Za-z0-9/_\-.]+$/.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && !url.username && !url.password ? normalized : '';
  } catch {
    return '';
  }
}
