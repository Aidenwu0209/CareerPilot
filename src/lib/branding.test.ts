import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANDING,
  normalizeBranding,
  serializeBrandingForDatabase,
  validateBranding,
} from './branding';

describe('organization branding', () => {
  it('normalizes stored JSON and safe values', () => {
    expect(normalizeBranding(JSON.stringify({
      productName: 'Campus Careers',
      tagline: 'Your next step',
      logoUrl: 'https://cdn.example.com/logo.svg',
      primaryColor: '#1a2b3c',
    }))).toEqual({
      productName: 'Campus Careers',
      tagline: 'Your next step',
      logoUrl: 'https://cdn.example.com/logo.svg',
      primaryColor: '#1A2B3C',
    });
  });

  it('rejects unsafe logo protocols and invalid colors', () => {
    expect(validateBranding({ productName: 'Safe Name', logoUrl: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'INVALID_LOGO_URL' });
    expect(validateBranding({ productName: 'Safe Name', primaryColor: 'red' })).toEqual({ ok: false, error: 'INVALID_PRIMARY_COLOR' });
  });

  it('accepts relative logos and empty optional fields', () => {
    const result = validateBranding({ productName: 'Career Center', tagline: '', logoUrl: '/logos/campus.svg', primaryColor: '#0066CC' });
    expect(result).toMatchObject({ ok: true, branding: { productName: 'Career Center', logoUrl: '/logos/campus.svg' } });
  });

  it('uses the correct representation for each database adapter', () => {
    const branding = { ...DEFAULT_BRANDING, productName: 'Acme Careers' };
    expect(serializeBrandingForDatabase(branding, 'sqlite')).toEqual(branding);
    expect(serializeBrandingForDatabase(branding, 'postgresql')).toBe(JSON.stringify(branding));
  });
});
