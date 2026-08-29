import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActiveContext } from '@/lib/auth/guards';
import { requestSchoolEmailVerification, SchoolError } from '@/lib/organizations/school-service';

const schema = z.object({ email: z.string().email().max(320) });

export async function POST(request: Request) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  try {
    const result = await requestSchoolEmailVerification(
      ctx.context.actor.userId,
      parsed.data.email,
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SchoolError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
}
