'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { readOptionalJsonBody } from '@/lib/http/json-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  Loader2,
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';

type Step = 'idle' | 'warning' | 'otp-request' | 'otp-enter' | 'final-confirm';

type ErrorState = string | null;

interface DeleteAccountSectionProps {
  userEmail: string | null;
  hasMemberships: boolean;
  orgNames: string[];
  resumeCount: number;
  interviewCount: number;
}

export function DeleteAccountSection({
  userEmail,
  hasMemberships,
  orgNames,
  resumeCount,
  interviewCount,
}: DeleteAccountSectionProps) {
  const t = useTranslations('account');
  const router = useRouter();

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<ErrorState>(null);
  const [loading, setLoading] = useState(false);

  // OTP flow state
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Final confirmation state
  const [confirmText, setConfirmText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deletionToken, setDeletionToken] = useState<string | null>(null);

  const CONFIRM_PHRASE = t('delete.confirmPhrase');

  const startCooldown = useCallback(() => {
    setResendCooldown(60);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const resetState = () => {
    setStep('idle');
    setError(null);
    setLoading(false);
    setOtpCode('');
    setOtpSent(false);
    setResendCooldown(0);
    setConfirmText('');
    setAcknowledged(false);
    setDeletionToken(null);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
  };

  // Step 1: Open warning dialog
  const handleOpenDialog = () => {
    setStep('warning');
    setError(null);
  };

  // Step 2: Proceed to OTP request
  const handleProceedToOtp = () => {
    if (!userEmail) {
      setError('EMAIL_REQUIRED');
      return;
    }
    setStep('otp-request');
  };

  // Step 3: Send OTP code
  const handleSendOtp = async () => {
    if (!userEmail || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      });
      if (res.status === 429) {
        setError('RATE_LIMITED');
        return;
      }
      if (!res.ok) {
        setError('OTP_SEND_FAILED');
        return;
      }
      setOtpSent(true);
      setStep('otp-enter');
      startCooldown();
    } catch {
      setError('OTP_SEND_FAILED');
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Verify OTP and get deletion token
  const handleVerifyOtp = async () => {
    if (loading || otpCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: otpCode }),
      });
      const data = await readOptionalJsonBody<{ error?: string; token?: string }>(res);
      if (!res.ok) {
        setError(data?.error || 'INVALID_OTP');
        return;
      }
      if (!data?.token) {
        setError('INVALID_RESPONSE');
        return;
      }
      // Token received — move to final confirmation
      setDeletionToken(data.token);
      setStep('final-confirm');
    } catch {
      setError('NETWORK_ERROR');
    } finally {
      setLoading(false);
    }
  };

  // Step 5: Final confirmation — execute deletion
  const handleConfirmDeletion = async () => {
    if (loading || !deletionToken) return;
    if (confirmText !== CONFIRM_PHRASE || !acknowledged) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: deletionToken }),
      });
      const data = await readOptionalJsonBody<{ error?: string }>(res);
      if (!res.ok) {
        setError(data?.error || 'DELETE_FAILED');
        return;
      }
      // Success — sign out and redirect
      setStep('idle');
      await signOut({ redirect: false });
      router.push('/');
    } catch {
      setError('NETWORK_ERROR');
    } finally {
      setLoading(false);
    }
  };

  const canConfirm = confirmText === CONFIRM_PHRASE && acknowledged;

  return (
    <div className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-6 dark:border-red-900/50 dark:bg-red-950/10">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
          <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-red-900 dark:text-red-200">
            {t('delete.title')}
          </h2>
          <p className="mt-1 text-sm text-red-700/80 dark:text-red-300/70">
            {t('delete.description')}
          </p>
          <div className="mt-4">
            <Button
              variant="destructive"
              onClick={handleOpenDialog}
              className="cursor-pointer"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              {t('delete.startButton')}
            </Button>
          </div>
        </div>
      </div>

      {/* Deletion Dialog */}
      <Dialog
        open={step !== 'idle'}
        onOpenChange={(open) => {
          if (!open) resetState();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <ShieldAlert className="h-5 w-5" />
              {t('delete.dialogTitle')}
            </DialogTitle>
          </DialogHeader>

          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {t(`delete.errors.${error}`, { fallback: error })}
            </div>
          )}

          {/* Step: Warning */}
          {step === 'warning' && (
            <div className="space-y-4">
              <DialogDescription>
                {t('delete.warningDescription')}
              </DialogDescription>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-2 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                  {t('delete.dataWillBeDeleted')}
                </p>
                <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {t('delete.items.resumes', { count: resumeCount })}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {t('delete.items.interviews', { count: interviewCount })}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {t('delete.items.chats')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {t('delete.items.shares')}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    {t('delete.items.auth')}
                  </li>
                  {hasMemberships && (
                    <li className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                      {t('delete.items.memberships', {
                        orgs: orgNames.join(', '),
                      })}
                    </li>
                  )}
                </ul>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('delete.retainedNote')}
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={resetState}
                  className="cursor-pointer"
                >
                  {t('delete.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleProceedToOtp}
                  disabled={!userEmail}
                  className="cursor-pointer"
                >
                  {t('delete.continue')}
                </Button>
              </DialogFooter>
              {!userEmail && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t('delete.noEmailWarning')}
                </p>
              )}
            </div>
          )}

          {/* Step: OTP Request */}
          {step === 'otp-request' && (
            <div className="space-y-4">
              <DialogDescription>
                {t('delete.otpRequestDescription', { email: userEmail! })}
              </DialogDescription>
              {!otpSent ? (
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setStep('warning')}
                    className="cursor-pointer"
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    {t('delete.back')}
                  </Button>
                  <Button
                    onClick={handleSendOtp}
                    disabled={loading}
                    className="cursor-pointer"
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t('delete.sendCode')}
                  </Button>
                </DialogFooter>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('delete.codeSent')}
                  </div>
                  <Button
                    onClick={() => setStep('otp-enter')}
                    className="w-full cursor-pointer"
                  >
                    {t('delete.enterCode')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step: OTP Enter */}
          {step === 'otp-enter' && (
            <div className="space-y-4">
              <DialogDescription>
                {t('delete.otpEnterDescription', { email: userEmail! })}
              </DialogDescription>
              <div className="space-y-2">
                <Label htmlFor="delete-otp">
                  {t('delete.otpLabel')}
                </Label>
                <Input
                  id="delete-otp"
                  value={otpCode}
                  onChange={(e) =>
                    setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                  className="text-center text-lg tracking-[0.5em]"
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setStep('warning')}
                  className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {t('delete.back')}
                </button>
                {resendCooldown > 0 ? (
                  <span className="text-zinc-400">
                    {t('delete.resendIn', { seconds: resendCooldown })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={loading}
                    className="cursor-pointer text-blue-500 hover:text-blue-700 dark:text-blue-400"
                  >
                    {t('delete.resend')}
                  </button>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={handleVerifyOtp}
                  disabled={loading || otpCode.length !== 6}
                  className="cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('delete.verifyAndContinue')}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step: Final Confirmation */}
          {step === 'final-confirm' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {t('delete.finalWarning')}
                </p>
              </div>
              <DialogDescription>
                {t('delete.typeToConfirm', { phrase: CONFIRM_PHRASE })}
              </DialogDescription>
              <div className="space-y-2">
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  className="border-red-300 focus:border-red-500 dark:border-red-800"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-zinc-300"
                />
                <span className="text-zinc-700 dark:text-zinc-300">
                  {t('delete.acknowledgment')}
                </span>
              </label>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={resetState}
                  className="cursor-pointer"
                >
                  {t('delete.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDeletion}
                  disabled={loading || !canConfirm}
                  className="cursor-pointer"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('delete.confirmDelete')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
