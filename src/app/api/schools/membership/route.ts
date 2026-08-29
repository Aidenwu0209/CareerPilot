import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { getSchoolMembership } from '@/lib/organizations/school-service';

export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  return NextResponse.json({ membership: await getSchoolMembership(ctx.context.actor.userId) });
}
