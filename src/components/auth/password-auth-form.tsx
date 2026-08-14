'use client';

import { useRef, useState } from 'react';
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
type FieldName = 'name' | 'email' | 'password' | 'confirmPassword';

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ login: null, register: null });

  const validateField = (field: FieldName, value: string): string | undefined => {
    if (field === 'name' && mode === 'register' && value.trim().length < 2) return t('fieldErrors.name');
    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return t('fieldErrors.email');
    if (field === 'password' && mode === 'register' && !(value.length >= 10 && /[A-Za-z]/.test(value) && /[0-9]/.test(value))) {
      return t('fieldErrors.password');
    }
    if (field === 'confirmPassword' && mode === 'register' && value !== password) return t('fieldErrors.confirmPassword');
    return undefined;
  };

  const validateOnBlur = (field: FieldName, value: string) => {
    setFieldErrors((current) => ({ ...current, [field]: validateField(field, value) }));
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setFieldErrors({});
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentMode: Mode) => {
    const modes: Mode[] = ['login', 'register'];
    let nextMode: Mode | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMode = modes[(modes.indexOf(currentMode) - 1 + modes.length) % modes.length];
    } else if (event.key === 'Home') {
      nextMode = modes[0];
    } else if (event.key === 'End') {
      nextMode = modes[modes.length - 1];
    }
    if (!nextMode) return;

    event.preventDefault();
    switchMode(nextMode);
    requestAnimationFrame(() => tabRefs.current[nextMode]?.focus());
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const nextFieldErrors: Partial<Record<FieldName, string>> = {
      email: validateField('email', email),
      password: validateField('password', password),
      ...(mode === 'register' ? {
        name: validateField('name', name),
        confirmPassword: validateField('confirmPassword', confirmPassword),
      } : {}),
    };
    setFieldErrors(nextFieldErrors);
    if (Object.values(nextFieldErrors).some(Boolean)) return;

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
        aria-orientation="horizontal"
        aria-label={t('methodLabel')}
        className="grid h-auto w-full grid-cols-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {(['login', 'register'] as const).map((item) => (
          <button
            key={item}
            ref={(element) => { tabRefs.current[item] = element; }}
            id={`password-auth-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={mode === item}
            aria-controls="password-auth-tabpanel"
            tabIndex={mode === item ? 0 : -1}
            onClick={() => switchMode(item)}
            onKeyDown={(event) => handleTabKeyDown(event, item)}
            className="h-9 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand aria-selected:bg-white aria-selected:text-zinc-900 aria-selected:shadow-sm dark:text-zinc-300 dark:hover:text-white dark:aria-selected:bg-zinc-700 dark:aria-selected:text-white"
          >
            {t(`tabs.${item}`)}
          </button>
        ))}
      </div>

      <div
        id="password-auth-tabpanel"
        role="tabpanel"
        aria-labelledby={`password-auth-tab-${mode}`}
        className="mt-5"
      >
      <form onSubmit={submit} className="space-y-4">
        {mode === 'register' && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('nameLabel')}
            </span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                id="password-auth-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={80}
                autoComplete="name"
                required
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'password-auth-name-error' : undefined}
                onBlur={(event) => validateOnBlur('name', event.target.value)}
                placeholder={t('namePlaceholder')}
                className="h-11 rounded-xl pl-10"
              />
            </span>
            {fieldErrors.name && <span id="password-auth-name-error" role="alert" className="block text-sm text-red-600 dark:text-red-400">{fieldErrors.name}</span>}
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('emailLabel')}
          </span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="password-auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'password-auth-email-error' : undefined}
              onBlur={(event) => validateOnBlur('email', event.target.value)}
              placeholder="you@example.com"
              className="h-11 rounded-xl pl-10"
            />
          </span>
          {fieldErrors.email && <span id="password-auth-email-error" role="alert" className="block text-sm text-red-600 dark:text-red-400">{fieldErrors.email}</span>}
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('passwordLabel')}
          </span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="password-auth-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === 'register' ? 10 : 1}
              maxLength={128}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'password-auth-password-error' : undefined}
              onBlur={(event) => validateOnBlur('password', event.target.value)}
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
          {fieldErrors.password && <span id="password-auth-password-error" role="alert" className="block text-sm text-red-600 dark:text-red-400">{fieldErrors.password}</span>}
        </label>

        {mode === 'register' && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('confirmPasswordLabel')}
            </span>
            <Input
              id="password-auth-confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={fieldErrors.confirmPassword ? 'password-auth-confirm-error' : undefined}
              onBlur={(event) => validateOnBlur('confirmPassword', event.target.value)}
              className="h-11 rounded-xl"
            />
            {fieldErrors.confirmPassword && <span id="password-auth-confirm-error" role="alert" className="block text-sm text-red-600 dark:text-red-400">{fieldErrors.confirmPassword}</span>}
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
    </div>
  );
}
