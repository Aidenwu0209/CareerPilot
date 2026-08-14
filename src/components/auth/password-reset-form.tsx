'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Step = 'request' | 'confirm' | 'complete';
type ErrorKind = 'INVALID_EMAIL' | 'INVALID_INPUT' | 'INVALID_CODE' | 'RATE_LIMITED' | 'PASSWORD_MISMATCH' | 'SERVER_ERROR';

export function PasswordResetForm() {
  const t = useTranslations('auth.reset');
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const requestCode = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/password/reset-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const kind = result.error === 'INVALID_EMAIL' || result.error === 'RATE_LIMITED'
          ? result.error as ErrorKind
          : 'SERVER_ERROR';
        setError(kind);
        if (typeof result.retryAfter === 'number') setCountdown(result.retryAfter);
        return;
      }
      setCountdown(typeof result.retryAfter === 'number' ? result.retryAfter : 60);
      setStep('confirm');
    } catch {
      setError('SERVER_ERROR');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('PASSWORD_MISMATCH');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/password/reset-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error === 'INVALID_CODE' || result.error === 'INVALID_INPUT'
          ? result.error as ErrorKind
          : 'SERVER_ERROR');
        return;
      }
      setStep('complete');
    } catch {
      setError('SERVER_ERROR');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'complete') {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('completeTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{t('completeDescription')}</p>
        <Button asChild className="mt-6 h-11 w-full rounded-xl bg-brand text-white hover:bg-brand-hover">
          <Link href="/login">{t('backToLogin')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {step === 'request' ? t('requestDescription') : t('confirmDescription', { email })}
        </p>
      </div>

      {step === 'request' ? (
        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void requestCode(); }}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('emailLabel')}</span>
            <span className="relative block">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 rounded-xl pl-10" />
            </span>
          </label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t(`errors.${error}`)}</p>}
          <Button type="submit" disabled={submitting || !email} className="h-11 w-full rounded-xl bg-brand text-white hover:bg-brand-hover">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('sendCode')}
          </Button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={confirmReset}>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('codeLabel')}</span>
            <Input inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="h-11 rounded-xl text-center font-mono text-lg tracking-[0.35em]" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('newPasswordLabel')}</span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input type={showPassword ? 'text' : 'password'} minLength={10} maxLength={128} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 rounded-xl px-10" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t('hidePassword') : t('showPassword')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
            <span className="block text-xs leading-5 text-zinc-500">{t('passwordHint')}</span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('confirmPasswordLabel')}</span>
            <Input type={showPassword ? 'text' : 'password'} minLength={10} maxLength={128} required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-11 rounded-xl" />
          </label>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t(`errors.${error}`)}</p>}
          <Button type="submit" disabled={submitting || code.length !== 6 || !password || !confirmPassword} className="h-11 w-full rounded-xl bg-brand text-white hover:bg-brand-hover">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('resetPassword')}
          </Button>
          <button type="button" disabled={submitting || countdown > 0} onClick={() => void requestCode()} className="w-full text-sm font-medium text-brand disabled:text-zinc-400">
            {countdown > 0 ? t('resendIn', { seconds: countdown }) : t('resend')}
          </button>
        </form>
      )}

      <div className="mt-6 text-center">
        <Link href="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-white">{t('backToLogin')}</Link>
      </div>
    </div>
  );
}
