'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, LifeBuoy, Loader2, MessageSquareText, Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SupportCategory, SupportStatus } from '@/lib/support/service';
import { useAuth } from '@/hooks/use-auth';

type Ticket = {
  id: string;
  category: SupportCategory;
  subject: string;
  description: string;
  status: SupportStatus;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

const categories: SupportCategory[] = ['account', 'billing', 'technical', 'career', 'other'];
const faqKeys = ['account', 'credits', 'career', 'privacy'] as const;

function statusVariant(status: SupportStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'replied') return 'default';
  if (status === 'closed') return 'secondary';
  return 'outline';
}

export function HelpCenter() {
  const t = useTranslations('help');
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category');
  const [category, setCategory] = useState<SupportCategory>(
    categories.includes(initialCategory as SupportCategory) ? initialCategory as SupportCategory : 'other',
  );
  const [subject, setSubject] = useState(searchParams.get('subject') ?? '');
  const [description, setDescription] = useState(searchParams.get('description') ?? '');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sessionRejected, setSessionRejected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/support/tickets', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setSessionRejected(true);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? 'LOAD_FAILED');
      setTickets(Array.isArray(result.tickets) ? result.tickets : []);
      setSessionRejected(false);
    } catch {
      setError(t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isAuthenticated) void loadTickets();
  }, [isAuthenticated, loadTickets]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, subject, description }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setSessionRejected(true);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? 'SUBMIT_FAILED');
      setSubject('');
      setDescription('');
      await loadTickets();
    } catch {
      setError(t('errors.submit'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-4 flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-brand" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{t('faq.title')}</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {faqKeys.map((key) => (
            <details key={key} className="group rounded-xl border bg-white p-4 dark:bg-zinc-950">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium marker:hidden">
                {t(`faq.items.${key}.question`)}
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{t(`faq.items.${key}.answer`)}</p>
            </details>
          ))}
        </div>
      </section>

      {authLoading ? (
        <div className="flex min-h-40 items-center justify-center" aria-label={t('loading')}>
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : !isAuthenticated || sessionRejected ? (
        <Card className="border-brand/20 bg-brand/5 text-center shadow-none">
          <CardHeader>
            <CardTitle>{t('auth.title')}</CardTitle>
            <CardDescription>{t('auth.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="bg-brand text-white hover:bg-brand-hover">
              <Link href="/login?callbackUrl=/help">{t('auth.action')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />{t('form.title')}</CardTitle>
              <CardDescription>{t('form.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('form.category')}</span>
                  <Select value={category} onValueChange={(value) => setCategory(value as SupportCategory)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map((value) => <SelectItem key={value} value={value}>{t(`categories.${value}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('form.subject')}</span>
                  <Input required minLength={3} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('form.descriptionLabel')}</span>
                  <Textarea required minLength={10} maxLength={4000} rows={6} value={description} onChange={(event) => setDescription(event.target.value)} />
                </label>
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <Button type="submit" disabled={submitting} className="w-full bg-brand text-white hover:bg-brand-hover">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('form.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" />{t('tickets.title')}</CardTitle>
              <CardDescription>{t('tickets.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-zinc-400" /> : tickets.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-zinc-500">{t('tickets.empty')}</p>
              ) : tickets.map((ticket) => (
                <article key={ticket.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{ticket.subject}</h3>
                      <p className="mt-1 text-xs text-zinc-500">{new Date(ticket.createdAt).toLocaleString()}</p>
                    </div>
                    <Badge variant={statusVariant(ticket.status)}>{t(`statuses.${ticket.status}`)}</Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600 dark:text-zinc-400">{ticket.description}</p>
                  {ticket.adminReply && (
                    <div className="mt-4 rounded-lg bg-brand/5 p-3 text-sm leading-6">
                      <p className="font-medium text-brand">{t('tickets.reply')}</p>
                      <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{ticket.adminReply}</p>
                    </div>
                  )}
                </article>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
