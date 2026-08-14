import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { getClientIP } from '@/lib/rate-limit/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (typeof body.email !== 'string') {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const result = await requestPasswordReset(body.email, getClientIP(request));
  if (!result.success) {
    const status = result.error === 'RATE_LIMITED' ? 429 : 400;
    return NextResponse.json({ error: result.error, retryAfter: result.retryAfter }, { status });
  }
  return NextResponse.json({ ok: true, retryAfter: result.retryAfter });
}
