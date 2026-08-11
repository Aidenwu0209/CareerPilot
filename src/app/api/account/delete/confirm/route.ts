import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { confirmAccountDeletion } from '@/lib/account/account-deletion';

/**
 * POST /api/account/delete/confirm
 *
 * Step 2 of the account deletion flow. Requires an active session and
 * the one-time confirmation token from /api/account/delete/initiate.
 *
 * On success, the user's data is deleted/anonymized and the response
 * instructs the client to clear its session and redirect to the homepage.
 *
 * The operation is idempotent — if a previous attempt partially failed,
 * calling this again will complete the remaining cleanup.
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

  // Parse body
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const token = body.token;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'TOKEN_REQUIRED' }, { status: 400 });
  }

  const result = await confirmAccountDeletion(userId, token);

  if (!result.success) {
    const statusMap: Record<string, number> = {
      INVALID_OR_EXPIRED_TOKEN: 401,
      USER_NOT_FOUND: 404,
    };
    return NextResponse.json(
      { error: result.error },
      { status: statusMap[result.error] || 400 },
    );
  }

  // Success — instruct client to sign out
  return NextResponse.json({
    success: true,
    userId: result.userId,
  });
}
