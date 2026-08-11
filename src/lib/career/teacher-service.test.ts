import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

import { db } from '@/lib/db';
import {
  careerProfiles,
  educationRoleAssignments,
  organizationMemberships,
  organizations,
  teacherStudentAssignments,
  users,
} from '@/lib/db/schema';
import {
  getAssignedStudentDetail,
  listAssignedStudents,
  resolveTeacherWorkspace,
} from './teacher-service';

const TEACHER_ID = 'teacher-1';
const STUDENT_ID = 'student-1';
const ADMIN_ID = 'platform-admin';
const ORG_ID = 'school-1';

beforeEach(async () => {
  await db.delete(teacherStudentAssignments);
  await db.delete(educationRoleAssignments);
  await db.delete(careerProfiles);
  await db.delete(organizationMemberships);
  await db.delete(organizations);
  await db.delete(users);
  await db.insert(users).values([
    { id: TEACHER_ID, name: '王老师', email: 'teacher@example.com', authType: 'oauth' },
    { id: STUDENT_ID, name: '李同学', email: 'student@example.com', authType: 'oauth', settings: { program: '软件工程', cohort: '2026届' } },
    { id: ADMIN_ID, name: '平台管理员', email: 'admin@example.com', authType: 'oauth', platformRole: 'super_admin' },
  ]);
  await db.insert(organizations).values({
    id: ORG_ID,
    slug: 'career-college',
    name: '职路学院',
    createdBy: ADMIN_ID,
  });
  await db.insert(organizationMemberships).values([
    { id: 'membership-teacher', organizationId: ORG_ID, userId: TEACHER_ID, role: 'org_admin' },
    { id: 'membership-student', organizationId: ORG_ID, userId: STUDENT_ID, role: 'member' },
  ]);
});

describe('teacher education authorization', () => {
  it('does not treat org_admin or platform super_admin as permission to read student career data', async () => {
    await expect(resolveTeacherWorkspace(TEACHER_ID)).resolves.toEqual({ status: 'unconfigured' });
    await expect(listAssignedStudents(TEACHER_ID)).resolves.toEqual([]);
    await expect(getAssignedStudentDetail(ADMIN_ID, STUDENT_ID)).resolves.toBeNull();
  });

  it('returns real assigned students only after education roles and explicit assignment exist', async () => {
    await db.insert(educationRoleAssignments).values([
      { id: 'role-teacher', organizationId: ORG_ID, userId: TEACHER_ID, role: 'teacher' },
      { id: 'role-student', organizationId: ORG_ID, userId: STUDENT_ID, role: 'student' },
    ]);
    await db.insert(teacherStudentAssignments).values({
      id: 'assignment-1',
      organizationId: ORG_ID,
      teacherUserId: TEACHER_ID,
      studentUserId: STUDENT_ID,
      accessLevel: 'guide',
    });

    const workspace = await resolveTeacherWorkspace(TEACHER_ID);
    expect(workspace.status).toBe('ready');
    if (workspace.status === 'ready') {
      expect(workspace.organizationId).toBe(ORG_ID);
      expect(workspace.view.recentStudents).toHaveLength(1);
    }
    const student = await getAssignedStudentDetail(TEACHER_ID, STUDENT_ID);
    expect(student).toMatchObject({ name: '李同学', program: '软件工程', cohort: '2026届' });
  });
});
