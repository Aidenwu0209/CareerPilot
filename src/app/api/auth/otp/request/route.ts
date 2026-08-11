import { NextRequest, NextResponse } from 'next/server';
import { requestOtp } from '@/lib/auth/email-otp';

/**
 * POST /api/auth/otp/request
 *
 * Request body: { email: string }
 *
 * Generates and sends a 6-digit OTP to the given email.
 * Applies rate limiting by IP and email.
 * Returns a generic success response even if the email has issues
 * (to prevent email enumeration).
 */
export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  const email = body?.email;
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 400 });
  }

  // Extract client IP
  const forwarded = req.headers.get('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;

  const result = await requestOtp(email, ipAddress);

  if (!result.success) {
    const status = result.error === 'RATE_LIMITED' ? 429 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
