import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {}, dbReady: Promise.resolve() }));

import {
  EvidenceReviewConflictError,
  executeEvidenceReviewWorkflow,
  type EvidenceReviewInput,
  type EvidenceReviewOperations,
} from './evidence-assessment';

const input: EvidenceReviewInput = {
  studentId: 'student-1',
  actorUserId: 'teacher-1',
  evidenceId: 'evidence-1',
  evidenceTitle: '课程项目',
  abilityCode: 'database',
  decision: 'confirmed',
  reason: '材料完整',
  score: 75,
};

function operations(asyncMode: boolean, calls: string[]): EvidenceReviewOperations {
  const value = <T>(result: T): T | Promise<T> => asyncMode ? Promise.resolve(result) : result;
  return {
    review: () => { calls.push('review'); return value([{ id: input.evidenceId }]); },
    insertAuditNote: () => { calls.push('audit'); return value(undefined); },
    aggregate: () => { calls.push('aggregate'); return value({ score: 75, evidenceCount: 2 }); },
    upsertAbility: () => { calls.push('ability'); return value(undefined); },
    listAbilities: () => {
      calls.push('abilities');
      return value([{ code: 'database', name: '数据库能力', dimension: 'professional_skills', score: 75 }]);
    },
    latestSnapshotVersion: () => { calls.push('version'); return value(3); },
    insertSnapshot: (_abilities, version) => { calls.push(`snapshot:${version}`); return value(undefined); },
  };
}

describe.each([
  ['synchronous SQLite operations', false],
  ['asynchronous PostgreSQL operations', true],
])('evidence review workflow with %s', (_label, asyncMode) => {
  it('executes the same ordered business transaction exactly once', async () => {
    const calls: string[] = [];
    const result = await executeEvidenceReviewWorkflow(
      operations(asyncMode, calls),
      input,
      { name: '数据库能力', dimension: 'professional_skills' },
    );
    expect(result).toEqual({
      code: 'database',
      name: '数据库能力',
      dimension: 'professional_skills',
      score: 75,
      confidence: 70,
      evidenceCount: 2,
    });
    expect(calls).toEqual(['review', 'audit', 'aggregate', 'ability', 'abilities', 'version', 'snapshot:4']);
  });
});

describe('evidence review workflow conflicts', () => {
  it('stops before every write after a lost pending-state race', () => {
    const followup = vi.fn();
    const conflictOperations: EvidenceReviewOperations = {
      ...operations(false, []),
      review: () => [],
      insertAuditNote: followup,
    };
    expect(() => executeEvidenceReviewWorkflow(
      conflictOperations,
      input,
      { name: '数据库能力', dimension: 'professional_skills' },
    )).toThrow(EvidenceReviewConflictError);
    expect(followup).not.toHaveBeenCalled();
  });
});
