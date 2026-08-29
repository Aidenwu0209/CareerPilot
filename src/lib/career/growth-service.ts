import 'server-only';

import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  careerAssessmentResults,
  careerCheckIns,
  careerFeatureUnlocks,
  careerStreakStats,
  careerTasks,
  jobSubscriptions,
} from '@/lib/db/schema';
import { getUserSubscription } from '@/lib/billing/service';
import { getOrCreateAccount } from '@/lib/credits/ledger';
import { debitAccountPortable } from '@/lib/credits/portable-ledger';
import { getCareerOverview } from './service';

export type CareerPaidFeature = 'assessment_report' | 'match_heatmap' | 'full_path';

const FEATURE_PRICE_ENV: Record<CareerPaidFeature, string> = {
  assessment_report: 'CAREER_UNLOCK_ASSESSMENT_CREDITS',
  match_heatmap: 'CAREER_UNLOCK_MATCH_CREDITS',
  full_path: 'CAREER_UNLOCK_PATH_CREDITS',
};
const FEATURE_PRICE_DEFAULT: Record<CareerPaidFeature, number> = {
  assessment_report: 80,
  match_heatmap: 120,
  full_path: 160,
};

export const FREE_ASSESSMENT_QUESTION_LIMIT = 10;

function featurePrice(feature: CareerPaidFeature): number {
  const parsed = Number.parseInt(process.env[FEATURE_PRICE_ENV[feature]] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : FEATURE_PRICE_DEFAULT[feature];
}

export function dateKey(date: Date, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

function previousDateKey(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function getStreak(userId: string, now = new Date(), timeZone = 'UTC') {
  const today = dateKey(now, timeZone);
  const [stats, todayRow] = await Promise.all([
    db.select().from(careerStreakStats).where(eq(careerStreakStats.userId, userId)).limit(1),
    db.select({ id: careerCheckIns.id }).from(careerCheckIns).where(and(
      eq(careerCheckIns.userId, userId), eq(careerCheckIns.checkInDate, today),
    )).limit(1),
  ]);
  return {
    currentStreak: stats[0]?.currentStreak ?? 0,
    longestStreak: stats[0]?.longestStreak ?? 0,
    totalCheckIns: stats[0]?.totalCheckIns ?? 0,
    lastCheckInDate: stats[0]?.lastCheckInDate ?? null,
    checkedInToday: Boolean(todayRow[0]),
    today,
  };
}

export async function checkIn(userId: string, options: { now?: Date; timeZone?: string; taskIdsCompleted?: string[] } = {}) {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone?.slice(0, 80) || 'UTC';
  const today = dateKey(now, timeZone);
  const [existing] = await db.select().from(careerCheckIns).where(and(
    eq(careerCheckIns.userId, userId), eq(careerCheckIns.checkInDate, today),
  )).limit(1);
  if (existing) return { ...(await getStreak(userId, now, timeZone)), idempotent: true };

  const [previous] = await db.select().from(careerStreakStats).where(eq(careerStreakStats.userId, userId)).limit(1);
  const nextStreak = previous?.lastCheckInDate === previousDateKey(today) ? previous.currentStreak + 1 : 1;
  const inserted = await db.insert(careerCheckIns).values({
    id: crypto.randomUUID(), userId, checkInDate: today, streakCount: nextStreak,
    taskIdsCompleted: (options.taskIdsCompleted ?? []).filter((id) => typeof id === 'string').slice(0, 100),
  } as never).onConflictDoNothing().returning({ id: careerCheckIns.id });
  if (!inserted.length) return { ...(await getStreak(userId, now, timeZone)), idempotent: true };

  await db.insert(careerStreakStats).values({
    userId, currentStreak: nextStreak, longestStreak: Math.max(previous?.longestStreak ?? 0, nextStreak),
    totalCheckIns: (previous?.totalCheckIns ?? 0) + 1, lastCheckInDate: today, updatedAt: now,
  } as never).onConflictDoUpdate({
    target: careerStreakStats.userId,
    set: {
      currentStreak: nextStreak,
      longestStreak: Math.max(previous?.longestStreak ?? 0, nextStreak),
      totalCheckIns: (previous?.totalCheckIns ?? 0) + 1,
      lastCheckInDate: today,
      updatedAt: now,
    },
  });
  return { ...(await getStreak(userId, now, timeZone)), idempotent: false };
}

export async function listJobSubscriptions(userId: string) {
  return db.select().from(jobSubscriptions).where(eq(jobSubscriptions.userId, userId)).orderBy(desc(jobSubscriptions.createdAt));
}

export async function createJobSubscription(userId: string, input: { keywords: string; city?: string; frequency?: 'daily' | 'weekly' }) {
  const keywords = input.keywords.trim().replace(/\s+/g, ' ');
  const city = input.city?.trim().replace(/\s+/g, ' ') ?? '';
  if (!keywords || keywords.length > 120 || city.length > 80) throw new Error('INVALID_JOB_SUBSCRIPTION');
  const id = crypto.randomUUID();
  await db.insert(jobSubscriptions).values({
    id, userId, keywords, city, frequency: input.frequency ?? 'weekly', active: true,
  } as never).onConflictDoNothing();
  return listJobSubscriptions(userId);
}

export async function getCareerAccess(userId: string) {
  const now = new Date();
  const [subscription, unlockRows] = await Promise.all([
    getUserSubscription(userId),
    db.select().from(careerFeatureUnlocks).where(and(
      eq(careerFeatureUnlocks.userId, userId),
      or(isNull(careerFeatureUnlocks.expiresAt), gt(careerFeatureUnlocks.expiresAt, now)),
    )),
  ]);
  const subscribed = subscription?.entitlement.status === 'active';
  const unlocked = new Set(unlockRows.map((row: typeof careerFeatureUnlocks.$inferSelect) => row.feature));
  return {
    subscribed,
    freeAssessmentQuestionLimit: FREE_ASSESSMENT_QUESTION_LIMIT,
    features: Object.fromEntries((Object.keys(FEATURE_PRICE_DEFAULT) as CareerPaidFeature[]).map((feature) => [feature, {
      unlocked: subscribed || unlocked.has(feature),
      priceCredits: featurePrice(feature),
    }])) as Record<CareerPaidFeature, { unlocked: boolean; priceCredits: number }>,
  };
}

export async function unlockCareerFeature(userId: string, feature: CareerPaidFeature) {
  const access = await getCareerAccess(userId);
  if (access.features[feature].unlocked) return { access, idempotent: true };
  const businessRefId = `career-unlock:${userId}:${feature}`;
  const account = await getOrCreateAccount('user', userId);
  const ledger = await debitAccountPortable({
    accountId: account.id,
    amount: featurePrice(feature),
    reason: 'consumption',
    businessRefId,
    idempotencyKey: businessRefId,
    operatorId: userId,
    ruleSnapshot: { feature, priceCredits: featurePrice(feature), version: 1 },
    note: `Career feature unlock: ${feature}`,
  });
  await db.insert(careerFeatureUnlocks).values({
    id: crypto.randomUUID(), userId, feature, source: 'credits', businessRefId,
  } as never).onConflictDoNothing();
  return { access: await getCareerAccess(userId), transactionId: ledger.transaction.id, idempotent: ledger.idempotent };
}

export async function getGrowthProgress(userId: string, now = new Date(), timeZone = 'UTC') {
  const [overview, streak, latestAssessments, taskCounts, subscriptions] = await Promise.all([
    getCareerOverview(userId),
    getStreak(userId, now, timeZone),
    db.select({ type: careerAssessmentResults.assessmentType }).from(careerAssessmentResults).where(and(
      eq(careerAssessmentResults.userId, userId), eq(careerAssessmentResults.isLatest, true),
    )),
    db.select({ status: careerTasks.status, count: sql<number>`count(*)` }).from(careerTasks)
      .where(eq(careerTasks.userId, userId)).groupBy(careerTasks.status),
    db.select({ count: sql<number>`count(*)` }).from(jobSubscriptions).where(and(
      eq(jobSubscriptions.userId, userId), eq(jobSubscriptions.active, true),
    )),
  ]);
  const counts = Object.fromEntries(taskCounts.map((row: { status: string; count: number }) => [row.status, Number(row.count)]));
  const totalTasks = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const completedTasks = counts.completed ?? 0;
  const assessmentTypes = new Set(latestAssessments.map((row: { type: string }) => row.type));
  return {
    streak,
    indicators: {
      readiness: overview.indicators.readiness,
      match: overview.indicators.match,
      taskCompletion: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0,
      assessmentCompletion: Math.round(assessmentTypes.size / 3 * 100),
    },
    assessments: ['holland', 'mbti', 'work_values'].map((type) => ({ type, completed: assessmentTypes.has(type) })),
    milestones: [
      { code: 'goal_set', achieved: Boolean(overview.primaryGoal) },
      { code: 'assessment_complete', achieved: assessmentTypes.size === 3 },
      { code: 'first_task_complete', achieved: completedTasks > 0 },
      { code: 'seven_day_streak', achieved: streak.longestStreak >= 7 },
    ],
    activeJobSubscriptions: Number(subscriptions[0]?.count ?? 0),
  };
}
