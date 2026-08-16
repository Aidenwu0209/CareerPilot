'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/routing';
import { normalizeInternalCallbackUrl } from '@/lib/auth/login-redirect';
import {
  ONBOARDING_FIELDS,
  ONBOARDING_FIELD_LIMITS,
  type FieldValidationError,
  type OnboardingField,
  validateOnboardingField,
  validateOnboardingProfile,
} from '@/lib/auth/form-validation';

export function OnboardingForm({ defaultName = '' }: { defaultName?: string }) {
  const t = useTranslations('onboarding');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeInternalCallbackUrl(
    searchParams.get('callbackUrl'),
    `/${locale}/dashboard`,
  );
  const [values, setValues] = useState<Record<OnboardingField, string>>({
    name: defaultName,
    school: '',
    major: '',
    academicStage: '',
    careerDirection: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<OnboardingField, FieldValidationError>>>({});

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const validationErrors = validateOnboardingProfile(values);
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError('profile');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/onboarding/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, termsAccepted, privacyAccepted }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; fields?: string[] };
        if (body.error === 'INVALID_PROFILE' && Array.isArray(body.fields)) {
          setFieldErrors(Object.fromEntries(
            body.fields
              .filter((field): field is OnboardingField => ONBOARDING_FIELDS.includes(field as OnboardingField))
              .map((field) => [field, validateOnboardingField(field, values[field]) ?? 'required']),
          ));
        }
        setError(body.error === 'CONSENT_REQUIRED' ? 'consent' : 'profile');
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError('server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {ONBOARDING_FIELDS.map((field) => {
          const fieldError = fieldErrors[field];
          const errorId = `${field}-error`;
          return (
          <label key={field} className={field === 'careerDirection' ? 'sm:col-span-2' : ''}>
            <span className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(`fields.${field}`)}
            </span>
            <Input
              value={values[field]}
              onChange={(event) => {
                const value = event.target.value;
                setValues((current) => ({ ...current, [field]: value }));
                if (fieldErrors[field]) {
                  setFieldErrors((current) => ({ ...current, [field]: undefined }));
                }
              }}
              onBlur={() => {
                const fieldError = validateOnboardingField(field, values[field]);
                setFieldErrors((current) => ({ ...current, [field]: fieldError ?? undefined }));
              }}
              maxLength={ONBOARDING_FIELD_LIMITS[field]}
              autoComplete={field === 'name' ? 'name' : 'off'}
              required
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? errorId : undefined}
            />
            {fieldError && (
              <span id={errorId} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {t(`fieldErrors.${fieldError}`, { max: ONBOARDING_FIELD_LIMITS[field] })}
              </span>
            )}
          </label>
          );
        })}
      </div>

      <div className="space-y-3 border-t border-zinc-200 pt-5 text-sm dark:border-zinc-800">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--brand)]"
          />
          <span className="text-zinc-600 dark:text-zinc-400">
            {t.rich('termsConsent', { terms: (chunks) => <Link href="/terms" className="text-brand underline">{chunks}</Link> })}
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={privacyAccepted}
            onChange={(event) => setPrivacyAccepted(event.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--brand)]"
          />
          <span className="text-zinc-600 dark:text-zinc-400">
            {t.rich('privacyConsent', { privacy: (chunks) => <Link href="/privacy" className="text-brand underline">{chunks}</Link> })}
          </span>
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t(`errors.${error}`)}</p>}

      <Button
        type="submit"
        disabled={submitting || !termsAccepted || !privacyAccepted}
        className="h-11 w-full bg-brand text-white hover:bg-brand-hover"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('submit')}
      </Button>
    </form>
  );
}
