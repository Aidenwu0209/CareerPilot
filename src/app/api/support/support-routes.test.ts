import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authState: {
  value: null | { ok: true; context: { actor: { userId: string; platformRole: 'user' | 'super_admin'; status: 'active' } } };
} = { value: null };

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => authState.value),
}));

const serviceMocks = vi.hoisted(() => ({
  create: vi.fn(),
  listUser: vi.fn(),
  listAdmin: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/support/service', () => ({
  supportStatuses: ['open', 'in_progress', 'replied', 'closed'],
  SupportValidationError: class SupportValidationError extends Error {},
  createSupportTicket: serviceMocks.create,
  listUserSupportTickets: serviceMocks.listUser,
  listAdminSupportTickets: serviceMocks.listAdmin,
  updateSupportTicket: serviceMocks.update,
}));

const auditMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/audit/audit-service', () => ({ recordAuditEvent: auditMock }));

import { GET as getUserTickets, POST as createUserTicket } from './tickets/route';
import { GET as getAdminTickets } from '@/app/api/admin/support/tickets/route';
import { PATCH as patchAdminTicket } from '@/app/api/admin/support/tickets/[id]/route';

beforeEach(() => {
  authState.value = null;
  vi.clearAllMocks();
  serviceMocks.create.mockResolvedValue({ id: 'ticket-1', status: 'open' });
  serviceMocks.listUser.mockResolvedValue([]);
  serviceMocks.listAdmin.mockResolvedValue({ rows: [], page: 1, pageSize: 20, total: 0, pageCount: 1 });
  serviceMocks.update.mockResolvedValue({ id: 'ticket-1', status: 'replied' });
  auditMock.mockResolvedValue('audit-1');
});

describe('support ticket routes', () => {
  it('requires authentication for user tickets', async () => {
    const response = await getUserTickets();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('uses the authenticated user id instead of client-supplied ownership', async () => {
    authState.value = { ok: true, context: { actor: { userId: 'actor-1', platformRole: 'user', status: 'active' } } };
    const response = await createUserTicket(new Request('http://localhost/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'attacker-choice', category: 'other', subject: 'Question', description: 'A detailed support question.' }),
    }));
    expect(response.status).toBe(201);
    expect(serviceMocks.create).toHaveBeenCalledWith('actor-1', expect.objectContaining({ userId: 'attacker-choice' }));
  });

  it('rejects non-admin access to the admin queue', async () => {
    authState.value = { ok: true, context: { actor: { userId: 'actor-1', platformRole: 'user', status: 'active' } } };
    const response = await getAdminTickets(new NextRequest('http://localhost/api/admin/support/tickets'));
    expect(response.status).toBe(403);
    expect(serviceMocks.listAdmin).not.toHaveBeenCalled();
  });

  it('allows an admin to reply and records an audit event', async () => {
    authState.value = { ok: true, context: { actor: { userId: 'admin-1', platformRole: 'super_admin', status: 'active' } } };
    const response = await patchAdminTicket(
      new Request('http://localhost/api/admin/support/tickets/ticket-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'replied', reply: 'Resolved.' }),
      }),
      { params: Promise.resolve({ id: 'ticket-1' }) },
    );
    expect(response.status).toBe(200);
    expect(serviceMocks.update).toHaveBeenCalledWith('ticket-1', 'admin-1', { status: 'replied', reply: 'Resolved.' });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin-1', targetId: 'ticket-1' }));
  });
});
