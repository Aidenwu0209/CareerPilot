import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { initiateAccountDeletion } from '@/lib/account/account-deletion';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  checkRateLimit,
  rateLimitKey,
} from '@/lib/rate-limit/rate-limit';

/**
 * POST /api/account/delete/initiate
 *
 * Step 1 of the account deletion flow. Requires an active session and
 * a valid OTP code for re-authentication. On success, returns a one-time
 * confirmation token that must be presented to /api/account/delete/confirm.
 *
 * AC1: Deletion requires recent re-authentication (OTP) and a one-time token
 */
export async function POST(request: Request) {
  const ctx = await resolveActiveContext();

  if (ctx === null) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  const userId = ctx.context.actor.userId;

  // Rate limit: prevent brute-force on OTP
  const rlKey = rateLimitKey('account-delete', 'user', userId);
  const rlResult = await checkRateLimit(rlKey, {
    limit: 5,
    windowMs: 60 * 60 * 1000, // 5 attempts per hour
    failClosed: true,
  });
  if (!rlResult.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: rlResult.retryAfter },
      { status: 429 },
    );
  }

  // Parse body
  let body: { otp?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const otpCode = body.otp;
  if (!otpCode || typeof otpCode !== 'string') {
    return NextResponse.json({ error: 'OTP_REQUIRED' }, { status: 400 });
  }

  // Get user email
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
  }

  const result = await initiateAccountDeletion(userId, userRows[0].email, otpCode);

  if (!result.success) {
    const status = result.error === 'EMAIL_REQUIRED' ? 400 : 401;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    token: result.token,
    expiresAt: result.expiresAt,
  });
}
