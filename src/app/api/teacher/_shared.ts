import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resolveTeacherStudentAccess } from '@/lib/auth/education-guard';
import { dbReady } from '@/lib/db';

const routeIdSchema = z.string().trim().min(1).max(128);

type TeacherStudentAuthorization =
  | {
      ok: true;
      actorUserId: string;
      studentId: string;
      organizationId: string;
    }
  | { ok: false; response: NextResponse };

/**
 * Resolve the authenticated actor and the explicit education assignment.
 * Billing/admin tenant roles never grant access through this helper.
 */
export async function authorizeTeacherStudentMutation(
  rawStudentId: string,
): Promise<TeacherStudentAuthorization> {
  const parsedStudentId = routeIdSchema.safeParse(rawStudentId);
  if (!parsedStudentId.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 }),
    };
  }

  await dbReady;
  const context = await resolveActiveContext();
  if (context === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  }
  if (!context.ok) return { ok: false, response: context.response };

  const actorUserId = context.context.actor.userId;
  const access = await resolveTeacherStudentAccess(
    actorUserId,
    parsedStudentId.data,
    'guide',
  );
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'TEACHER_ACCESS_DENIED' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    actorUserId,
    studentId: parsedStudentId.data,
    organizationId: access.organizationId,
  };
}

export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
