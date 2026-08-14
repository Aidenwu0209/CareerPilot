import { NextResponse } from 'next/server';
import { confirmPasswordReset } from '@/lib/auth/password-reset';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const result = await confirmPasswordReset(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
