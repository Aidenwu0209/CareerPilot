import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  educationRoleAssignments,
  organizationMemberships,
  organizations,
  teacherStudentAssignments,
} from '@/lib/db/schema';

export type EducationRole = 'student' | 'teacher' | 'counselor';
export type StudentAccessLevel = 'view' | 'guide' | 'manage';

const ACCESS_RANK: Record<StudentAccessLevel, number> = {
  view: 1,
  guide: 2,
  manage: 3,
};

export interface TeacherEducationContext {
  teacherUserId: string;
  organizationId: string;
  organizationName: string;
  role: 'teacher' | 'counselor';
}

/**
 * Resolve active education roles independently from the billing tenant.
 * A commercial org_admin role never implies access to student career data.
 */
export async function listTeacherEducationContexts(
  userId: string,
): Promise<TeacherEducationContext[]> {
  const rows = await db
    .select({
      organizationId: educationRoleAssignments.organizationId,
      organizationName: organizations.name,
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

  return (rows as Array<{ organizationId: string; organizationName: string; role: string }>)
    .filter(
      (row): row is typeof row & { role: 'teacher' | 'counselor' } =>
        row.role === 'teacher' || row.role === 'counselor',
    )
    .map((row) => ({
      teacherUserId: userId,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      role: row.role,
    }));
}

export interface TeacherStudentAccess extends TeacherEducationContext {
  studentUserId: string;
  accessLevel: StudentAccessLevel;
}

/**
 * Check the complete education boundary for a single student. The teacher and
 * student must both have active organization memberships and education roles,
 * plus an active explicit assignment in the same organization.
 */
export async function resolveTeacherStudentAccess(
  teacherUserId: string,
  studentUserId: string,
  requiredLevel: StudentAccessLevel = 'view',
): Promise<TeacherStudentAccess | null> {
  if (teacherUserId === studentUserId) return null;

  const rows = await db
    .select({
      organizationId: teacherStudentAssignments.organizationId,
      organizationName: organizations.name,
      accessLevel: teacherStudentAssignments.accessLevel,
      teacherRole: educationRoleAssignments.role,
    })
    .from(teacherStudentAssignments)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, teacherStudentAssignments.organizationId),
        eq(organizations.status, 'active'),
      ),
    )
    .innerJoin(
      educationRoleAssignments,
      and(
        eq(educationRoleAssignments.organizationId, teacherStudentAssignments.organizationId),
        eq(educationRoleAssignments.userId, teacherStudentAssignments.teacherUserId),
        eq(educationRoleAssignments.status, 'active'),
      ),
    )
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, teacherStudentAssignments.organizationId),
        eq(organizationMemberships.userId, teacherStudentAssignments.teacherUserId),
        eq(organizationMemberships.status, 'active'),
      ),
    )
    .where(
      and(
        eq(teacherStudentAssignments.teacherUserId, teacherUserId),
        eq(teacherStudentAssignments.studentUserId, studentUserId),
        eq(teacherStudentAssignments.status, 'active'),
      ),
    );

  for (const row of rows) {
    if (row.teacherRole !== 'teacher' && row.teacherRole !== 'counselor') continue;
    const accessLevel = row.accessLevel as StudentAccessLevel;
    if (ACCESS_RANK[accessLevel] < ACCESS_RANK[requiredLevel]) continue;

    const studentMembership = await db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .innerJoin(
        educationRoleAssignments,
        and(
          eq(educationRoleAssignments.organizationId, organizationMemberships.organizationId),
          eq(educationRoleAssignments.userId, organizationMemberships.userId),
          eq(educationRoleAssignments.role, 'student'),
          eq(educationRoleAssignments.status, 'active'),
        ),
      )
      .where(
        and(
          eq(organizationMemberships.organizationId, row.organizationId),
          eq(organizationMemberships.userId, studentUserId),
          eq(organizationMemberships.status, 'active'),
        ),
      )
      .limit(1);

    if (studentMembership[0]) {
      return {
        teacherUserId,
        studentUserId,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        role: row.teacherRole,
        accessLevel,
      };
    }
  }

  return null;
}
