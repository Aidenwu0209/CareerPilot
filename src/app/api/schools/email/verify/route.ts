import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActiveContext } from '@/lib/auth/guards';
import { SchoolError, verifySchoolEmailAndBind } from '@/lib/organizations/school-service';

const schema = z.object({ email: z.string().email().max(320), code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try {
    return NextResponse.json({ membership: await verifySchoolEmailAndBind(ctx.context.actor.userId, parsed.data.email, parsed.data.code) });
  } catch (error) {
    if (error instanceof SchoolError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
}
