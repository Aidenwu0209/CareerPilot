import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

const authState = {
  userId: null as string | null,
  allowedPairs: new Set<string>(),
};

vi.mock('@/lib/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { resolve } = await import('path');
  const schema = await import('@/lib/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  return { db, dbReady: Promise.resolve() };
});

// The route selects the transaction API from the configured database type.
// Keep that configuration aligned with the in-memory SQLite database above,
// even when CI exports DB_TYPE=postgresql for production build validation.
vi.mock('@/lib/config', () => ({
  config: { db: { type: 'sqlite' as const } },
}));

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => {
    if (authState.userId === null) return null;
    return {
      ok: true as const,
      context: {
        actor: { userId: authState.userId, platformRole: 'user' as const, status: 'active' as const },
        tenant: { type: 'personal' as const, organizationId: null, orgRole: null },
        billing: { accountOwnerType: 'user' as const, accountOwnerId: authState.userId },
      },
    };
  }),
}));

vi.mock('@/lib/auth/education-guard', () => ({
  resolveTeacherStudentAccess: vi.fn(async (teacherUserId: string, studentUserId: string) => {
    if (!authState.allowedPairs.has(`${teacherUserId}:${studentUserId}`)) return null;
    return {
      teacherUserId,
      studentUserId,
      organizationId: 'test-education-org',
      organizationName: '测试院校',
      role: 'teacher' as const,
      accessLevel: 'guide' as const,
    };
  }),
}));

import { POST as createGuidance } from './students/[studentId]/guidance/route';
import { POST as createTask } from './students/[studentId]/tasks/route';
import { POST as reviewEvidence } from './students/[studentId]/evidence/[evidenceId]/review/route';
import { db } from '@/lib/db';
import {
  careerEvidence,
  careerGuidanceNotes,
  careerProfileSnapshots,
  careerTasks,
  users,
} from '@/lib/db/schema';

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function allow(teacherId: string, studentId: string) {
  authState.userId = teacherId;
  authState.allowedPairs.add(`${teacherId}:${studentId}`);
}

async function seedUsers(...ids: string[]) {
  await db.insert(users).values(ids.map((id) => ({
    id,
    name: id,
    email: `${id}@test.local`,
    authType: 'email' as const,
  })));
}

beforeEach(() => {
  authState.userId = null;
  authState.allowedPairs.clear();
});

describe('teacher student mutation routes', () => {
  it('returns 401 when the actor is unauthenticated', async () => {
    const response = await createGuidance(
      jsonRequest('/api/teacher/students/student-unauth/guidance', {
        visibility: 'student',
        content: '继续补充项目证据。',
      }),
      { params: Promise.resolve({ studentId: 'student-unauth' }) },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'AUTH_REQUIRED' });
  });

  it('returns 403 without an explicit guide assignment', async () => {
    authState.userId = 'teacher-no-assignment';
    const response = await createGuidance(
      jsonRequest('/api/teacher/students/student-no-assignment/guidance', {
        visibility: 'student',
        content: '继续补充项目证据。',
      }),
      { params: Promise.resolve({ studentId: 'student-no-assignment' }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'TEACHER_ACCESS_DENIED' });
  });

  it('rejects a cross-student route even when another student is assigned', async () => {
    allow('teacher-cross-route', 'student-assigned');
    const response = await createGuidance(
      jsonRequest('/api/teacher/students/student-unassigned/guidance', {
        visibility: 'private',
        content: '仅教师可见。',
      }),
      { params: Promise.resolve({ studentId: 'student-unassigned' }) },
    );
    expect(response.status).toBe(403);
  });

  it('returns 400 for an invalid request body', async () => {
    allow('teacher-invalid-body', 'student-invalid-body');
    const response = await createGuidance(
      jsonRequest('/api/teacher/students/student-invalid-body/guidance', {
        visibility: 'management',
        content: '',
      }),
      { params: Promise.resolve({ studentId: 'student-invalid-body' }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'INVALID_BODY' });
  });

  it('creates a guidance note with the server-mapped visibility', async () => {
    const teacherId = `teacher-guidance-${crypto.randomUUID()}`;
    const studentId = `student-guidance-${crypto.randomUUID()}`;
    await seedUsers(teacherId, studentId);
    allow(teacherId, studentId);

    const response = await createGuidance(
      jsonRequest(`/api/teacher/students/${studentId}/guidance`, {
        visibility: 'private',
        content: '建议先核验项目角色，再调整岗位目标。',
      }),
      { params: Promise.resolve({ studentId }) },
    );
    expect(response.status).toBe(201);

    const rows = await db.select().from(careerGuidanceNotes).where(and(
      eq(careerGuidanceNotes.userId, studentId),
      eq(careerGuidanceNotes.teacherId, teacherId),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0].visibility).toBe('teacher_private');
  });

  it('creates a structured task and rejects an unknown ability key', async () => {
    const teacherId = `teacher-task-${crypto.randomUUID()}`;
    const studentId = `student-task-${crypto.randomUUID()}`;
    await seedUsers(teacherId, studentId);
    allow(teacherId, studentId);

    const invalidResponse = await createTask(
      jsonRequest(`/api/teacher/students/${studentId}/tasks`, {
        title: '不可解释任务',
        abilityKey: 'invented_ability',
        dueDate: '2027-06-30',
        reason: '测试非法能力项。',
        completionCriteria: '不应写入。',
      }),
      { params: Promise.resolve({ studentId }) },
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({ error: 'INVALID_ABILITY_KEY' });

    const response = await createTask(
      jsonRequest(`/api/teacher/students/${studentId}/tasks`, {
        title: '完成一次项目复盘',
        abilityKey: 'project_practice',
        dueDate: '2027-06-30',
        reason: '当前项目证据覆盖不足。',
        completionCriteria: '提交一份含指标和个人贡献的复盘。',
      }),
      { params: Promise.resolve({ studentId }) },
    );
    expect(response.status).toBe(201);

    const tasks = await db.select().from(careerTasks).where(eq(careerTasks.userId, studentId));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      abilityCode: 'project_practice',
      reason: '当前项目证据覆盖不足。',
      completionCriteria: '提交一份含指标和个人贡献的复盘。',
      assignedBy: teacherId,
    });
  });

  it('returns 404 when an assigned student does not own the evidence', async () => {
    const teacherId = `teacher-evidence-cross-${crypto.randomUUID()}`;
    const ownerId = `student-evidence-owner-${crypto.randomUUID()}`;
    const otherId = `student-evidence-other-${crypto.randomUUID()}`;
    const evidenceId = `evidence-cross-${crypto.randomUUID()}`;
    await seedUsers(teacherId, ownerId, otherId);
    await db.insert(careerEvidence).values({
      id: evidenceId,
      userId: ownerId,
      abilityCode: 'project_practice',
      sourceType: 'project',
      title: '归属其他学生的证据',
    });
    allow(teacherId, otherId);

    const response = await reviewEvidence(
      jsonRequest(`/api/teacher/students/${otherId}/evidence/${evidenceId}/review`, {
        decision: 'confirmed',
        reason: '尝试跨学生审核。',
      }),
      { params: Promise.resolve({ studentId: otherId, evidenceId }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'EVIDENCE_NOT_FOUND' });
  });

  it('reviews pending evidence once and preserves an audit note and snapshot', async () => {
    const teacherId = `teacher-review-${crypto.randomUUID()}`;
    const studentId = `student-review-${crypto.randomUUID()}`;
    const evidenceId = `evidence-review-${crypto.randomUUID()}`;
    await seedUsers(teacherId, studentId);
    await db.insert(careerEvidence).values({
      id: evidenceId,
      userId: studentId,
      abilityCode: 'project_practice',
      sourceType: 'project',
      title: '校园项目复盘',
      excerpt: '负责前端性能优化并提供量化指标。',
    });
    allow(teacherId, studentId);

    const requestBody = { decision: 'confirmed' as const, reason: '材料与项目记录一致。' };
    const firstResponse = await reviewEvidence(
      jsonRequest(`/api/teacher/students/${studentId}/evidence/${evidenceId}/review`, requestBody),
      { params: Promise.resolve({ studentId, evidenceId }) },
    );
    expect(firstResponse.status).toBe(200);

    const reviewed = (await db.select().from(careerEvidence).where(eq(careerEvidence.id, evidenceId)))[0];
    expect(reviewed).toMatchObject({
      status: 'verified',
      reviewedBy: teacherId,
      reviewReason: requestBody.reason,
    });
    expect(reviewed.reviewedAt).toBeInstanceOf(Date);

    const auditNotes = await db.select().from(careerGuidanceNotes).where(and(
      eq(careerGuidanceNotes.userId, studentId),
      eq(careerGuidanceNotes.visibility, 'management'),
    ));
    expect(auditNotes).toHaveLength(1);
    expect(auditNotes[0].content).toContain(evidenceId);
    expect(auditNotes[0].content).toContain(requestBody.reason);

    const snapshots = await db.select().from(careerProfileSnapshots)
      .where(eq(careerProfileSnapshots.userId, studentId));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].trigger).toContain(`evidence_review:confirmed:${evidenceId}`);

    const duplicateResponse = await reviewEvidence(
      jsonRequest(`/api/teacher/students/${studentId}/evidence/${evidenceId}/review`, requestBody),
      { params: Promise.resolve({ studentId, evidenceId }) },
    );
    expect(duplicateResponse.status).toBe(409);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ error: 'EVIDENCE_ALREADY_REVIEWED' });
  });
});
