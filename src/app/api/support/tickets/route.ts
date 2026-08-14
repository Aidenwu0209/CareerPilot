import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import {
  createSupportTicket,
  listUserSupportTickets,
  SupportValidationError,
} from '@/lib/support/service';

export const runtime = 'nodejs';

async function activeUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const context = await resolveActiveContext();
  if (!context) return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  if (!context.ok) return { ok: false, response: context.response };
  return { ok: true, userId: context.context.actor.userId };
}

export async function GET() {
  const auth = await activeUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ tickets: await listUserSupportTickets(auth.userId) });
}

export async function POST(request: Request) {
  const auth = await activeUser();
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  try {
    const ticket = await createSupportTicket(auth.userId, body);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportValidationError) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    throw error;
  }
}
