import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { collectUserData } from '@/lib/export/user-data-export';

/**
 * POST /api/account/export
 *
 * Generates a full data export for the current user and returns it as a
 * downloadable JSON file. The endpoint is protected by the session cookie
 * (enforced by middleware), and the response includes Content-Disposition
 * to trigger a browser download.
 *
 * AC1: Export contains user profile, settings, resumes, shares, chat,
 *      analyses, interviews, credit transactions, and membership
 * AC2: Export identifies generation time, schema version, each collection
 * AC3: Only current user's data — no other members, platform keys, or rules
 * AC4: Session-protected — after logout the endpoint returns 401
 * AC5: Per-collection failure handling — failed collections report errors
 *      but do not abort the entire export
 */
export async function POST() {
  const ctx = await resolveActiveContext();

  if (ctx === null) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (!ctx.ok) {
    return ctx.response;
  }

  const userId = ctx.context.actor.userId;

  const data = await collectUserData(userId);

  const filename = `careerpilot-export-${userId.slice(0, 8)}-${Date.now()}.json`;

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
