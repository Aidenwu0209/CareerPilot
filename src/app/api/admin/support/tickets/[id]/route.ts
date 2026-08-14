import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { recordAuditEvent } from '@/lib/audit/audit-service';
import { SupportValidationError, updateSupportTicket } from '@/lib/support/service';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveActiveContext();
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!auth.ok) return auth.response;
  if (auth.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  const { id } = await params;
  try {
    const ticket = await updateSupportTicket(id, auth.context.actor.userId, body);
    if (!ticket) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    await recordAuditEvent({
      actorId: auth.context.actor.userId,
      action: 'support.ticket.update',
      targetType: 'support_ticket',
      targetId: id,
      result: 'success',
      summary: `Updated support ticket status to ${ticket.status}`,
    });
    return NextResponse.json({ ticket });
  } catch (error) {
    if (error instanceof SupportValidationError) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    throw error;
  }
}
