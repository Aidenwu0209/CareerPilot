import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  listAdminSupportTickets,
  supportStatuses,
  type SupportStatus,
} from '@/lib/support/service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await resolveActiveContext();
  if (!context) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!context.ok) return context.response;
  if (context.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const rawStatus = request.nextUrl.searchParams.get('status');
  const status = rawStatus && supportStatuses.includes(rawStatus as SupportStatus)
    ? rawStatus as SupportStatus
    : undefined;
  const page = Number(request.nextUrl.searchParams.get('page') ?? '1');
  return NextResponse.json(await listAdminSupportTickets({
    status,
    page: Number.isFinite(page) ? page : 1,
  }));
}
