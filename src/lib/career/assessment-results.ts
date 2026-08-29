import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { careerAssessmentResults, occupations } from '@/lib/db/schema';
import { scoreAssessmentDimensions, scoreSelfAssessment } from './self-assessment';

export type AssessmentType = 'holland' | 'mbti' | 'work_values';

const HOLLAND_CODE: Record<string, string> = {
  realistic: 'R', investigative: 'I', artistic: 'A', social: 'S', enterprising: 'E', conventional: 'C',
};

const HOLLAND_KEYWORDS: Record<string, string[]> = {
  R: ['工程', '制造', '建筑', '设备', '机械', 'engineering', 'operations', 'construction'],
  I: ['研究', '数据', '科学', '技术', '分析', 'research', 'data', 'science', 'software'],
  A: ['设计', '媒体', '内容', '艺术', '创意', 'design', 'media', 'creative', 'content'],
  S: ['教育', '医疗', '咨询', '服务', '社会', 'education', 'health', 'counsel', 'social'],
  E: ['管理', '销售', '运营', '商业', '创业', 'management', 'sales', 'business', 'marketing'],
  C: ['财务', '行政', '审计', '合规', '流程', 'finance', 'audit', 'compliance', 'administration'],
};

function asObject(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

async function matchedOccupations(hollandCode: string): Promise<string[]> {
  const rows = await db.select({ code: occupations.code, name: occupations.name, category: occupations.category, industry: occupations.industry, summary: occupations.summary })
    .from(occupations).where(eq(occupations.active, true));
  const scored: Array<{ code: string; score: number }> = rows.map((row: { code: string; name: string; category: string; industry: string; summary: string }) => {
    const haystack = `${row.name} ${row.category} ${row.industry} ${row.summary}`.toLowerCase();
    const score = [...hollandCode].reduce((sum, code) => sum + (HOLLAND_KEYWORDS[code] ?? []).filter((keyword) => haystack.includes(keyword)).length, 0);
    return { code: row.code, score };
  });
  return scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, 8).map((item) => item.code);
}

export async function persistAssessmentResults(userId: string, answers: Record<string, number>) {
  const result = scoreSelfAssessment(answers);
  const hollandCode = result.interestCodes.map((code) => HOLLAND_CODE[code]).filter(Boolean).join('');
  const occupationCodes = await matchedOccupations(hollandCode);
  const records: Array<{ type: AssessmentType; code: string; scores: Record<string, number>; matches: string[] }> = [
    {
      type: 'holland',
      code: hollandCode,
      scores: scoreAssessmentDimensions('interests', answers),
      matches: occupationCodes,
    },
    {
      type: 'mbti',
      code: result.personalityType ?? '',
      scores: scoreAssessmentDimensions('personality', answers),
      matches: occupationCodes,
    },
    {
      type: 'work_values',
      code: result.valueCodes.join(','),
      scores: scoreAssessmentDimensions('values', answers),
      matches: occupationCodes,
    },
  ];

  for (const record of records) {
    await db.update(careerAssessmentResults).set({ isLatest: false }).where(and(
      eq(careerAssessmentResults.userId, userId),
      eq(careerAssessmentResults.assessmentType, record.type),
      eq(careerAssessmentResults.isLatest, true),
    ));
    await db.insert(careerAssessmentResults).values({
      id: crypto.randomUUID(), userId, assessmentType: record.type, resultCode: record.code,
      answers, dimensionScores: record.scores, matchedOccupationCodes: record.matches, isLatest: true,
    } as never);
  }
  return getLatestAssessmentResults(userId);
}

export async function getLatestAssessmentResults(userId: string) {
  return db.select().from(careerAssessmentResults).where(and(
    eq(careerAssessmentResults.userId, userId), eq(careerAssessmentResults.isLatest, true),
  )).orderBy(careerAssessmentResults.assessmentType);
}

export async function getAssessmentHistory(userId: string, limit = 30) {
  return db.select().from(careerAssessmentResults)
    .where(eq(careerAssessmentResults.userId, userId))
    .orderBy(desc(careerAssessmentResults.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
}

export async function getOccupationAssessmentAlignment(userId: string, occupation: { code: string; name: string; category: string; summary: string }) {
  const latest = await getLatestAssessmentResults(userId);
  if (!latest.length) return null;
  const holland = latest.find((item: typeof careerAssessmentResults.$inferSelect) => item.assessmentType === 'holland');
  const mbti = latest.find((item: typeof careerAssessmentResults.$inferSelect) => item.assessmentType === 'mbti');
  const values = latest.find((item: typeof careerAssessmentResults.$inferSelect) => item.assessmentType === 'work_values');
  const matched = Array.isArray(holland?.matchedOccupationCodes) && holland.matchedOccupationCodes.includes(occupation.code);
  const interest = matched ? 100 : 55;
  const text = `${occupation.name} ${occupation.category} ${occupation.summary}`.toLowerCase();
  const personalityType = mbti?.resultCode ?? '';
  let personality = 65;
  if (/[ei]/i.test(personalityType)) {
    const peopleFacing = ['教育', '销售', '咨询', '服务', 'management', 'sales', 'social'].some((keyword) => text.includes(keyword));
    personality = peopleFacing === personalityType.startsWith('E') ? 85 : 60;
  }
  const preferredValues = (values?.resultCode ?? '').split(',').filter(Boolean);
  const valueAlignment = preferredValues.length ? Math.min(90, 60 + preferredValues.length * 10) : 60;
  return {
    interest,
    personality,
    values: valueAlignment,
    score: Math.round(interest * 0.5 + personality * 0.3 + valueAlignment * 0.2),
    resultCodes: Object.fromEntries(latest.map((item: typeof careerAssessmentResults.$inferSelect) => [item.assessmentType, item.resultCode])),
    dimensions: asObject(holland?.dimensionScores),
  };
}
