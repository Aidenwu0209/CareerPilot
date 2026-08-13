'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeInternalCallbackUrl } from '@/lib/auth/login-redirect';

type Mode = 'login' | 'register';
type ErrorKind =
  | null
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'EMAIL_EXISTS'
  | 'RATE_LIMITED'
  | 'PASSWORD_MISMATCH'
  | 'SERVER_ERROR';

export function PasswordAuthForm() {
  const t = useTranslations('auth.password');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const callbackUrl = normalizeInternalCallbackUrl(
    searchParams.get('callbackUrl'),
    `/${locale}/dashboard`,
  );

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorKind>(null);

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('PASSWORD_MISMATCH');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/password/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { name, email, password } : { email, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const supportedErrors: ErrorKind[] = [
          'INVALID_INPUT',
          'INVALID_CREDENTIALS',
          'ACCOUNT_SUSPENDED',
          'EMAIL_EXISTS',
          'RATE_LIMITED',
        ];
        setError(supportedErrors.includes(result.error) ? result.error : 'SERVER_ERROR');
        return;
      }

      const destination = result.onboardingRequired
        ? `/${locale}/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : callbackUrl;
      // The session cookie is written by the API response. A document-level
      // replacement ensures the root SessionProvider and every client-side
      // account control hydrate from that new session immediately.
      window.location.replace(destination);
    } catch {
      setError('SERVER_ERROR');
    } finally {
      setSubmitting(false);
    }
  };

  const passwordIsValid = password.length >= 10 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
  const canSubmit = Boolean(
    email
    && password
    && (mode === 'login' || (name.trim().length >= 2 && passwordIsValid && confirmPassword)),
  );

  return (
    <div>
      <div
        role="tablist"
        aria-label={t('methodLabel')}
        className="grid grid-cols-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {(['login', 'register'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            onClick={() => switchMode(item)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === item
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {t(`tabs.${item}`)}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === 'register' && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('nameLabel')}
            </span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
                placeholder={t('namePlaceholder')}
                className="h-11 rounded-xl pl-10"
              />
            </span>
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('emailLabel')}
          </span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="h-11 rounded-xl pl-10"
            />
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('passwordLabel')}
          </span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === 'register' ? 10 : 1}
              maxLength={128}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              className="h-11 rounded-xl px-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-zinc-200"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
          {mode === 'register' && (
            <span className="block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {t('passwordHint')}
            </span>
          )}
        </label>

        {mode === 'register' && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('confirmPasswordLabel')}
            </span>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
              className="h-11 rounded-xl"
            />
          </label>
        )}

        <div aria-live="polite" aria-atomic="true">
          {error && (
            <p role="alert" className="text-sm leading-5 text-red-600 dark:text-red-400">
              {t(`errors.${error}`)}
              {error === 'EMAIL_EXISTS' && (
                <button type="button" onClick={() => switchMode('login')} className="ml-1 underline">
                  {t('useLogin')}
                </button>
              )}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={submitting || !canSubmit}
          className="h-11 w-full rounded-xl bg-brand text-sm font-medium text-white hover:bg-brand-hover"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t(`submit.${mode}`)}
        </Button>
      </form>
    </div>
  );
}
