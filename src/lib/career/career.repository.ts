import 'server-only';

import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerGuidanceNotes,
  careerMatches,
  careerProfiles,
  careerProfileSnapshots,
  careerTasks,
  occupationRequirements,
  occupations,
  users,
} from '@/lib/db/schema';
import type {
  CareerGoalInput,
  CareerMatchResult,
  CareerTaskInput,
  CareerTaskStatus,
} from '@/types/career';

export type CareerProfileRow = typeof careerProfiles.$inferSelect;
export type CareerAbilityRow = typeof careerAbilities.$inferSelect;
export type CareerEvidenceRow = typeof careerEvidence.$inferSelect;
export type CareerGoalRow = typeof careerGoals.$inferSelect;
export type CareerTaskRow = typeof careerTasks.$inferSelect;
export type CareerProfileSnapshotRow = typeof careerProfileSnapshots.$inferSelect;

export const careerRepository = {
  async ensureProfile(userId: string): Promise<CareerProfileRow | null> {
    await dbReady;
    const existing = await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId)).limit(1);
    if (existing[0]) return existing[0];
    await db.insert(careerProfiles).values({ userId } as never).onConflictDoNothing();
    return (await db.select().from(careerProfiles).where(eq(careerProfiles.userId, userId)).limit(1))[0] ?? null;
  },

  async findProfileData(userId: string): Promise<{
    abilities: CareerAbilityRow[];
    evidence: CareerEvidenceRow[];
  }> {
    await dbReady;
    const [abilities, evidence] = await Promise.all([
      db.select().from(careerAbilities).where(eq(careerAbilities.userId, userId)).orderBy(asc(careerAbilities.code)),
      db.select().from(careerEvidence).where(eq(careerEvidence.userId, userId)).orderBy(desc(careerEvidence.createdAt)),
    ]);
    return { abilities, evidence };
  },

  async isActiveScorableOccupation(code: string): Promise<boolean> {
    await dbReady;
    const rows = await db.select({ code: occupations.code }).from(occupations)
      .innerJoin(occupationRequirements, eq(occupationRequirements.occupationCode, occupations.code))
      .where(and(eq(occupations.code, code), eq(occupations.active, true), eq(occupations.scoringEligible, true)))
      .limit(1);
    return Boolean(rows[0]);
  },

  async findGoals(userId: string): Promise<Array<{ goal: CareerGoalRow; occupationName: string | null }>> {
    await dbReady;
    return db.select({ goal: careerGoals, occupationName: occupations.name }).from(careerGoals)
      .leftJoin(occupations, eq(occupations.code, careerGoals.occupationCode))
      .where(and(eq(careerGoals.userId, userId), ne(careerGoals.status, 'archived')))
      .orderBy(desc(careerGoals.isPrimary), desc(careerGoals.updatedAt));
  },

  async findTasks(userId: string): Promise<CareerTaskRow[]> {
    await dbReady;
    return db.select().from(careerTasks)
      .where(eq(careerTasks.userId, userId))
      .orderBy(asc(careerTasks.dueAt), desc(careerTasks.updatedAt));
  },

  async hasActiveGoal(userId: string, occupationCode: string): Promise<boolean> {
    const rows = await db.select({ id: careerGoals.id }).from(careerGoals).where(and(
      eq(careerGoals.userId, userId),
      eq(careerGoals.occupationCode, occupationCode),
      ne(careerGoals.status, 'archived'),
    )).limit(1);
    return Boolean(rows[0]);
  },

  async findActiveRequirement(occupationCode: string, abilityCode: string): Promise<{
    abilityName: string;
    dimension: CareerAbilityRow['dimension'];
  } | null> {
    const rows = await db.select({
      abilityName: occupationRequirements.abilityName,
      dimension: occupationRequirements.dimension,
    }).from(occupationRequirements)
      .innerJoin(occupations, and(
        eq(occupations.code, occupationRequirements.occupationCode),
        eq(occupations.active, true),
      ))
      .where(and(
        eq(occupationRequirements.occupationCode, occupationCode),
        eq(occupationRequirements.abilityCode, abilityCode),
      ))
      .limit(1);
    return rows[0] ?? null;
  },

  async upsertAbilityDefinition(input: {
    userId: string;
    code: string;
    name: string;
    dimension: CareerAbilityRow['dimension'];
  }): Promise<void> {
    await db.insert(careerAbilities).values({
      userId: input.userId,
      code: input.code,
      name: input.name,
      dimension: input.dimension,
      score: null,
      confidence: null,
    } as never).onConflictDoUpdate({
      target: [careerAbilities.userId, careerAbilities.code],
      set: { name: input.name, dimension: input.dimension, updatedAt: new Date() },
    });
  },

  async createManualEvidence(input: {
    id: string;
    userId: string;
    occupationCode: string;
    abilityCode: string;
    title: string;
    description: string;
    sourceUrl: string | null;
  }): Promise<CareerEvidenceRow | null> {
    await db.insert(careerEvidence).values({
      id: input.id,
      userId: input.userId,
      abilityCode: input.abilityCode,
      sourceType: 'manual',
      sourceId: `manual:${input.occupationCode}:${input.id}`,
      title: input.title,
      excerpt: input.description,
      sourceUrl: input.sourceUrl,
      status: 'pending',
      assessedScore: null,
    });
    return (await db.select().from(careerEvidence).where(and(
      eq(careerEvidence.id, input.id),
      eq(careerEvidence.userId, input.userId),
    )).limit(1))[0] ?? null;
  },

  async findPreviousMatchScore(userId: string, occupationCode: string): Promise<{ score: number | null } | null> {
    return (await db.select({ score: careerMatches.score })
      .from(careerMatches)
      .where(and(eq(careerMatches.userId, userId), eq(careerMatches.occupationCode, occupationCode)))
      .orderBy(desc(careerMatches.createdAt))
      .limit(1))[0] ?? null;
  },

  async insertMatch(userId: string, goalId: string | null, result: CareerMatchResult): Promise<void> {
    await db.insert(careerMatches).values({
      userId,
      goalId,
      occupationCode: result.occupation.code,
      score: result.score,
      evidenceCoverage: result.evidenceCoverage,
      knownWeight: result.knownWeight,
      totalWeight: result.totalWeight,
      breakdown: result.dimensionBreakdown,
      citations: result.citations,
      algorithmVersion: result.algorithmVersion,
      catalogVersion: result.catalogVersion,
      confidence: result.confidence,
      knownCoverage: result.knownCoverage,
    } as never);
  },

  async findLatestAbilitySnapshots(userId: string): Promise<CareerProfileSnapshotRow[]> {
    return db.select().from(careerProfileSnapshots)
      .where(eq(careerProfileSnapshots.userId, userId))
      .orderBy(desc(careerProfileSnapshots.version))
      .limit(2);
  },

  async findLatestStudentGuidance(userId: string): Promise<Array<{
    id: string;
    teacherId: string;
    teacherName: string | null;
    visibility: 'student' | 'teacher_private' | 'management';
    content: string;
    createdAt: Date;
  }>> {
    return db.select({
      id: careerGuidanceNotes.id,
      teacherId: careerGuidanceNotes.teacherId,
      teacherName: users.name,
      visibility: careerGuidanceNotes.visibility,
      content: careerGuidanceNotes.content,
      createdAt: careerGuidanceNotes.createdAt,
    }).from(careerGuidanceNotes)
      .innerJoin(users, eq(users.id, careerGuidanceNotes.teacherId))
      .where(and(eq(careerGuidanceNotes.userId, userId), eq(careerGuidanceNotes.visibility, 'student')))
      .orderBy(desc(careerGuidanceNotes.createdAt))
      .limit(5) as unknown as Array<{
        id: string;
        teacherId: string;
        teacherName: string | null;
        visibility: 'student' | 'teacher_private' | 'management';
        content: string;
        createdAt: Date;
      }>;
  },

  async hasTasksForGoal(goalId: string): Promise<boolean> {
    return Boolean((await db.select({ id: careerTasks.id }).from(careerTasks).where(eq(careerTasks.goalId, goalId)).limit(1))[0]);
  },

  async saveGoal(userId: string, input: CareerGoalInput, targetDate: Date | null, now: Date): Promise<CareerGoalRow | null> {
    if (input.isPrimary ?? true) {
      await db.update(careerGoals).set({ isPrimary: false, updatedAt: now })
        .where(and(eq(careerGoals.userId, userId), eq(careerGoals.isPrimary, true)));
    }
    const existing = (await db.select().from(careerGoals)
      .where(and(
        eq(careerGoals.userId, userId),
        eq(careerGoals.occupationCode, input.occupationCode),
        ne(careerGoals.status, 'archived'),
      ))
      .limit(1))[0];
    const isPrimary = input.isPrimary ?? true;
    const id = existing?.id ?? crypto.randomUUID();
    if (existing) {
      await db.update(careerGoals).set({
        isPrimary,
        status: 'active',
        targetDate,
        rationale: input.rationale?.trim() ?? existing.rationale,
        preferences: input.preferences ?? existing.preferences,
        teacherConfirmationStatus: 'unreviewed',
        updatedAt: now,
      }).where(and(eq(careerGoals.id, id), eq(careerGoals.userId, userId)));
    } else {
      await db.insert(careerGoals).values({
        id,
        userId,
        occupationCode: input.occupationCode,
        isPrimary,
        status: 'active',
        targetDate,
        rationale: input.rationale?.trim() ?? '',
        preferences: input.preferences ?? {},
        teacherConfirmationStatus: 'unreviewed',
      } as never);
    }
    await db.update(careerProfiles).set({ stage: 'targeting', updatedAt: now }).where(eq(careerProfiles.userId, userId));
    return (await db.select().from(careerGoals).where(and(eq(careerGoals.id, id), eq(careerGoals.userId, userId))).limit(1))[0] ?? null;
  },

  async findGoalById(userId: string, goalId: string): Promise<{ id: string } | null> {
    return (await db.select({ id: careerGoals.id }).from(careerGoals)
      .where(and(eq(careerGoals.id, goalId), eq(careerGoals.userId, userId)))
      .limit(1))[0] ?? null;
  },

  async hasLegacyGoal(userId: string, occupationCode: string): Promise<boolean> {
    return this.hasActiveGoal(userId, occupationCode);
  },

  async createTask(userId: string, input: CareerTaskInput, title: string, dueAt: Date | null): Promise<CareerTaskRow | null> {
    const id = crypto.randomUUID();
    await db.insert(careerTasks).values({
      id,
      userId,
      goalId: input.goalId ?? null,
      occupationCode: input.occupationCode ?? null,
      abilityCode: input.abilityCode ?? null,
      title,
      description: input.description?.trim() ?? '',
      reason: input.reason?.trim() ?? '',
      completionCriteria: input.completionCriteria?.trim() ?? '',
      category: input.category ?? 'learn',
      dueAt,
      assignedBy: input.assignedBy ?? null,
    } as never);
    return (await db.select().from(careerTasks).where(and(eq(careerTasks.id, id), eq(careerTasks.userId, userId))).limit(1))[0] ?? null;
  },

  async updateTaskStatus(userId: string, taskId: string, status: CareerTaskStatus): Promise<CareerTaskRow | null> {
    const existing = (await db.select().from(careerTasks)
      .where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)))
      .limit(1))[0];
    if (!existing) return null;
    const now = new Date();
    await db.update(careerTasks).set({
      status,
      completedAt: status === 'completed' ? now : null,
      updatedAt: now,
    }).where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)));
    if (existing.status !== 'completed' && status === 'completed' && existing.abilityCode) {
      await db.insert(careerEvidence).values({
        id: `task-evidence:${existing.id}:${existing.abilityCode}`,
        userId,
        abilityCode: existing.abilityCode,
        sourceType: 'task',
        sourceId: existing.id,
        title: existing.title,
        excerpt: existing.completionCriteria || existing.description,
        status: 'pending',
        occurredAt: now,
      } as never).onConflictDoNothing();
    }
    return (await db.select().from(careerTasks)
      .where(and(eq(careerTasks.id, taskId), eq(careerTasks.userId, userId)))
      .limit(1))[0] ?? null;
  },
};
