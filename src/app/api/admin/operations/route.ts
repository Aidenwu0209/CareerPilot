import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getOperationsDashboard } from '@/lib/admin/operations-dashboard';

export async function GET() {
  const context = await resolveActiveContext();
  if (context === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!context.ok) return context.response;
  if (context.context.actor.platformRole !== 'super_admin') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  return NextResponse.json(await getOperationsDashboard(), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
