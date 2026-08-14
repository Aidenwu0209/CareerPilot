'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquareReply } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { SupportStatus } from '@/lib/support/service';

type AdminTicket = {
  id: string;
  userName: string | null;
  userEmail: string | null;
  category: string;
  subject: string;
  description: string;
  status: SupportStatus;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
};

const statuses: SupportStatus[] = ['open', 'in_progress', 'replied', 'closed'];

export function AdminSupportManager() {
  const t = useTranslations('admin.support');
  const [status, setStatus] = useState<'all' | SupportStatus>('all');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [selected, setSelected] = useState<AdminTicket | null>(null);
  const [editStatus, setEditStatus] = useState<SupportStatus>('open');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page) });
      if (status !== 'all') query.set('status', status);
      const response = await fetch(`/api/admin/support/tickets?${query}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'LOAD_FAILED');
      setTickets(Array.isArray(result.rows) ? result.rows : []);
      setPageCount(Math.max(1, Number(result.pageCount) || 1));
    } catch {
      setError(t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [page, status, t]);

  useEffect(() => { void load(); }, [load]);

  const openTicket = (ticket: AdminTicket) => {
    setSelected(ticket);
    setEditStatus(ticket.status);
    setReply(ticket.adminReply ?? '');
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/support/tickets/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: editStatus, ...(reply.trim() ? { reply } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'SAVE_FAILED');
      setSelected(null);
      await load();
    } catch {
      setError(t('errors.save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status} onValueChange={(value) => { setStatus(value as 'all' | SupportStatus); setPage(1); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.all')}</SelectItem>
            {statuses.map((value) => <SelectItem key={value} value={value}>{t(`statuses.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{t('refresh')}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-zinc-400" /> : tickets.length === 0 ? (
        <Card className="border-dashed shadow-none"><CardContent className="text-center text-sm text-zinc-500">{t('empty')}</CardContent></Card>
      ) : tickets.map((ticket) => (
        <Card key={ticket.id} className="gap-0 py-0 shadow-none">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{ticket.subject}</h2>
                <Badge variant={ticket.status === 'closed' ? 'secondary' : ticket.status === 'replied' ? 'default' : 'outline'}>{t(`statuses.${ticket.status}`)}</Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{ticket.userName || ticket.userEmail || t('unknownUser')} · {new Date(ticket.createdAt).toLocaleString()}</p>
              <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600 dark:text-zinc-400">{ticket.description}</p>
            </div>
            <Button variant="outline" onClick={() => openTicket(ticket)} className="shrink-0"><MessageSquareReply className="h-4 w-4" />{t('review')}</Button>
          </CardContent>
        </Card>
      ))}
      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('previous')}</Button>
        <span className="text-sm text-zinc-500">{t('page', { page, pageCount })}</span>
        <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{t('next')}</Button>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.subject}</DialogTitle>
            <DialogDescription>{selected?.userName || selected?.userEmail || t('unknownUser')}</DialogDescription>
          </DialogHeader>
          {selected && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-sm leading-6 dark:bg-zinc-900">{selected.description}</p>}
          <label className="space-y-1.5">
            <span className="text-sm font-medium">{t('statusLabel')}</span>
            <Select value={editStatus} onValueChange={(value) => setEditStatus(value as SupportStatus)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{t(`statuses.${value}`)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">{t('replyLabel')}</span>
            <Textarea rows={7} maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t('replyPlaceholder')} />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>{t('cancel')}</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
