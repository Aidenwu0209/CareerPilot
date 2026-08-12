import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'admin-user',
  platformRole: 'super_admin' as 'super_admin' | 'user',
  workspace: { status: 'denied' } as {
    status: 'denied' | 'unconfigured' | 'ready';
    organizationId?: string;
    view?: { queue: never[]; recentStudents: never[] };
  },
  memberships: [] as Array<{ orgId: string; orgName: string }>,
  educationRoles: [] as Array<{ orgId: string; role: string }>,
  selectCount: 0,
}));

vi.mock('@/lib/auth/guards', () => ({
  resolveActiveContext: vi.fn(async () => ({
    ok: true as const,
    context: {
      actor: {
        userId: state.userId,
        platformRole: state.platformRole,
        status: 'active' as const,
      },
      tenant: { type: 'personal' as const, organizationId: null, orgRole: null },
      billing: { accountOwnerType: 'user' as const, accountOwnerId: state.userId },
    },
  })),
}));

vi.mock('@/lib/db', () => {
  function queryResult(rows: unknown[]) {
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => rows),
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return builder;
  }

  return {
    db: {
      select: vi.fn(() => {
        const rows = state.selectCount % 2 === 0
          ? state.memberships
          : state.educationRoles;
        state.selectCount += 1;
        return queryResult(rows);
      }),
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  educationRoleAssignments: { organizationId: 'education.organizationId', userId: 'education.userId', role: 'education.role', status: 'education.status' },
  organizationMemberships: { organizationId: 'membership.organizationId', userId: 'membership.userId', role: 'membership.role', status: 'membership.status' },
  organizations: { id: 'organization.id', name: 'organization.name', status: 'organization.status' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => true),
  and: vi.fn(() => true),
}));

vi.mock('@/lib/career/teacher-service', () => ({
  resolveTeacherWorkspace: vi.fn(async () => state.workspace),
}));

import { resolveTeacherWorkspace } from '@/lib/career/teacher-service';
import { GET } from './route';

beforeEach(() => {
  state.memberships.splice(0);
  state.educationRoles.splice(0);
  state.selectCount = 0;
  state.userId = 'admin-user';
  state.platformRole = 'super_admin';
  state.workspace = { status: 'denied' };
  vi.clearAllMocks();
});

describe('GET /api/user/nav-context teacher visibility', () => {
  it('does not infer teacher access from super_admin or org_admin', async () => {
    state.memberships.push({ orgId: 'school-1', orgName: 'Career School' });

    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({
      platformRole: 'super_admin',
      isOrgAdmin: true,
      isTeacher: false,
      teacherOrgId: null,
    });
    expect(resolveTeacherWorkspace).not.toHaveBeenCalled();
  });

  it('shows teacher navigation only for a role with an active student workspace', async () => {
    state.userId = 'teacher-user';
    state.platformRole = 'user';
    state.educationRoles.push({ orgId: 'school-2', role: 'teacher' });
    state.workspace = {
      status: 'ready',
      organizationId: 'school-2',
      view: { queue: [], recentStudents: [] },
    };

    const response = await GET();
    const body = await response.json();

    expect(resolveTeacherWorkspace).toHaveBeenCalledWith('teacher-user');
    expect(body).toMatchObject({
      isTeacher: true,
      teacherOrgId: 'school-2',
    });
  });
});
