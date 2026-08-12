import { NextResponse } from 'next/server';
import { resolveActiveContext } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  educationRoleAssignments,
  organizationMemberships,
  organizations,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveTeacherWorkspace } from '@/lib/career/teacher-service';

/**
 * GET /api/user/nav-context
 *
 * Returns the user's role context for navigation rendering.
 * - platformRole: 'super_admin' | 'user'
 * - isOrgAdmin: whether the user is an active org_admin of any active org
 * - orgId: the organization ID if the user is an org admin (null otherwise)
 */
export async function GET() {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const userId = ctx.context.actor.userId;
  const platformRole = ctx.context.actor.platformRole;

  // Check if user is an active org_admin of any active org
  const memberships = await db
    .select({
      orgId: organizationMemberships.organizationId,
      orgName: organizations.name,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.role, 'org_admin'),
        eq(organizationMemberships.status, 'active'),
        eq(organizations.status, 'active'),
      ),
    )
    .limit(1);

  const isOrgAdmin = memberships.length > 0;

  const educationRoles = await db
    .select({
      orgId: educationRoleAssignments.organizationId,
      role: educationRoleAssignments.role,
    })
    .from(educationRoleAssignments)
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, educationRoleAssignments.organizationId),
        eq(organizationMemberships.userId, educationRoleAssignments.userId),
        eq(organizationMemberships.status, 'active'),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, educationRoleAssignments.organizationId),
        eq(organizations.status, 'active'),
      ),
    )
    .where(
      and(
        eq(educationRoleAssignments.userId, userId),
        eq(educationRoleAssignments.status, 'active'),
      ),
    );

  const hasTeacherRole = educationRoles.some(
    (assignment: { role: string }) =>
      assignment.role === 'teacher' || assignment.role === 'counselor',
  );
  const teacherWorkspace = hasTeacherRole
    ? await resolveTeacherWorkspace(userId)
    : { status: 'denied' as const };
  const isTeacher = teacherWorkspace.status === 'ready';

  return NextResponse.json({
    platformRole,
    isOrgAdmin,
    isTeacher,
    orgId: memberships[0]?.orgId ?? null,
    orgName: memberships[0]?.orgName ?? null,
    teacherOrgId: isTeacher ? teacherWorkspace.organizationId : null,
  });
}
