'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';
import { normalizeInternalCallbackUrl } from '@/lib/auth/login-redirect';

type Step = 'email' | 'code' | 'verifying';
type ErrorKind = null | 'INVALID_EMAIL' | 'RATE_LIMITED' | 'INVALID_CODE' | 'SERVER_ERROR' | 'EXPIRED' | 'USED' | 'ACCOUNT_MIGRATION_REQUIRED';

const RESEND_COOLDOWN = 60; // seconds

export function EmailOtpLogin() {
  const t = useTranslations('auth.otp');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeInternalCallbackUrl(
    searchParams.get('callbackUrl'),
    `/${locale}/dashboard`,
  );

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<ErrorKind>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Resend countdown
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const isValidEmail = useCallback((value: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }, []);

  const maskedEmail = useCallback((addr: string) => {
    const [local, domain] = addr.split('@');
    if (!domain) return addr;
    const visible = local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(local.length - 2, 2))}@${domain}`;
  }, []);

  const handleRequestOtp = async () => {
    setError(null);

    if (!isValidEmail(email)) {
      setError('INVALID_EMAIL');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        setError('RATE_LIMITED');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVER_ERROR');
        return;
      }

      setStep('code');
      setResendIn(RESEND_COOLDOWN);
    } catch {
      setError('SERVER_ERROR');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError(null);
    setStep('verifying');

    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      if (res.status === 429) {
        setError('RATE_LIMITED');
        setStep('code');
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'EXPIRED') setError('EXPIRED');
        else if (data.error === 'USED') setError('USED');
        else if (data.error === 'ACCOUNT_MIGRATION_REQUIRED') setError('ACCOUNT_MIGRATION_REQUIRED');
        else setError('INVALID_CODE');
        setStep('code');
        return;
      }

      const data = await res.json();
      const destination = data.onboardingRequired
        ? `/${locale}/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : callbackUrl;
      router.push(destination);
      router.refresh();
    } catch {
      setError('SERVER_ERROR');
      setStep('code');
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError(null);
    setCode('');
    await handleRequestOtp();
  };

  const handleBackToEmail = () => {
    setStep('email');
    setCode('');
    setError(null);
    setResendIn(0);
  };

  // ── Email step ──
  if (step === 'email') {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('emailLabel')}
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) handleRequestOtp();
              }}
              className="h-11 rounded-xl pl-10"
              disabled={loading}
              aria-invalid={error === 'INVALID_EMAIL'}
            />
          </div>
          {error === 'INVALID_EMAIL' && (
            <p className="text-xs text-red-500">{t('errors.invalidEmail')}</p>
          )}
        </div>

        <Button
          onClick={handleRequestOtp}
          disabled={loading || !email}
          className="h-11 w-full cursor-pointer rounded-xl text-sm font-medium"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('sendCode')}
        </Button>

        {error === 'RATE_LIMITED' && (
          <p className="text-center text-xs text-red-500">{t('errors.rateLimited')}</p>
        )}
        {error === 'SERVER_ERROR' && (
          <p className="text-center text-xs text-red-500">{t('errors.serverError')}</p>
        )}
      </div>
    );
  }

  // ── Code entry step ──
  return (
    <div className="space-y-4">
      <button
        onClick={handleBackToEmail}
        className="inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('changeEmail')}
      </button>

      <div className="space-y-1.5">
        <label htmlFor="code" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('codeLabel')}
        </label>
        <p className="text-xs text-zinc-400">
          {t('codeSentTo', { email: maskedEmail(email) })}
        </p>
        <Input
          id="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.length === 6 && step !== 'verifying') handleVerifyOtp();
          }}
          className="h-11 rounded-xl text-center text-lg tracking-[0.5em]"
          disabled={step === 'verifying'}
          autoFocus
        />
      </div>

      <Button
        onClick={handleVerifyOtp}
        disabled={step === 'verifying' || code.length !== 6}
        className="h-11 w-full cursor-pointer rounded-xl text-sm font-medium"
      >
        {step === 'verifying' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('verify')}
      </Button>

      {/* Errors */}
      {error === 'INVALID_CODE' && (
        <p className="text-center text-xs text-red-500">{t('errors.invalidCode')}</p>
      )}
      {error === 'EXPIRED' && (
        <p className="text-center text-xs text-red-500">{t('errors.expired')}</p>
      )}
      {error === 'USED' && (
        <p className="text-center text-xs text-red-500">{t('errors.used')}</p>
      )}
      {error === 'RATE_LIMITED' && (
        <p className="text-center text-xs text-red-500">{t('errors.rateLimited')}</p>
      )}
      {error === 'SERVER_ERROR' && (
        <p className="text-center text-xs text-red-500">{t('errors.serverError')}</p>
      )}
      {error === 'ACCOUNT_MIGRATION_REQUIRED' && (
        <p className="text-center text-xs leading-5 text-red-500">{t('errors.accountMigrationRequired')}</p>
      )}

      {/* Resend */}
      <div className="text-center">
        {resendIn > 0 ? (
          <p className="text-xs text-zinc-400">
            {t('resendIn', { seconds: resendIn })}
          </p>
        ) : (
          <button
            onClick={handleResend}
            disabled={step === 'verifying'}
            className="text-xs text-brand underline hover:no-underline disabled:opacity-50"
          >
            {t('resend')}
          </button>
        )}
      </div>
    </div>
  );
}
