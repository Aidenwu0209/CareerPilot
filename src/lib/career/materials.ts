import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db, dbReady } from '@/lib/db';
import {
  careerAbilities,
  careerEvidence,
  interviewReports,
  interviewSessions,
  resumes,
  resumeSections,
} from '@/lib/db/schema';
import type { AbilityDimensionCode, CareerMaterialSyncResult } from '@/types/career';
import { ABILITY_CATALOG } from './catalog';

interface EvidenceCandidate {
  abilityCode: string;
  abilityName: string;
  dimension: AbilityDimensionCode;
  sourceType: 'resume' | 'project' | 'interview' | 'certificate';
  sourceId: string;
  title: string;
  excerpt: string;
  occurredAt: Date | null;
  score?: number;
}

const KEYWORD_RULES: Array<{ abilityCode: string; patterns: RegExp[] }> = [
  { abilityCode: 'web_frontend', patterns: [/\breact\b/i, /\bvue\b/i, /javascript/i, /typescript/i, /\bhtml\b/i, /\bcss\b/i] },
  { abilityCode: 'backend_engineering', patterns: [/node\.js/i, /spring/i, /django/i, /flask/i, /fastapi/i, /\bjava\b/i, /\bgolang\b/i, /rest\s*api/i] },
  { abilityCode: 'database', patterns: [/\bsql\b/i, /mysql/i, /postgres/i, /mongodb/i, /redis/i, /数据库/] },
  { abilityCode: 'data_analysis', patterns: [/pandas/i, /excel/i, /tableau/i, /power\s*bi/i, /数据分析/] },
  { abilityCode: 'statistics', patterns: [/统计/i, /regression/i, /hypothesis/i] },
  { abilityCode: 'machine_learning', patterns: [/机器学习/i, /machine\s*learning/i, /pytorch/i, /tensorflow/i, /大模型/i, /\brag\b/i] },
  { abilityCode: 'product_discovery', patterns: [/产品/i, /需求分析/i, /用户故事/i] },
  { abilityCode: 'ux_research', patterns: [/用户研究/i, /可用性测试/i, /user\s*research/i] },
  { abilityCode: 'visual_design', patterns: [/figma/i, /视觉设计/i, /交互设计/i, /ui\s*design/i] },
  { abilityCode: 'testing', patterns: [/测试/i, /vitest/i, /jest/i, /playwright/i, /cypress/i] },
  { abilityCode: 'cloud_automation', patterns: [/docker/i, /kubernetes/i, /\bk8s\b/i, /aws/i, /azure/i, /ci\/?cd/i, /云平台/i] },
  { abilityCode: 'security', patterns: [/安全/i, /security/i, /漏洞/i, /penetration/i] },
  { abilityCode: 'mobile_engineering', patterns: [/swiftui/i, /\bswift\b/i, /kotlin/i, /flutter/i, /react\s*native/i, /android/i, /\bios\b/i] },
];

const abilityByCode = new Map(ABILITY_CATALOG.map((ability) => [ability.code, ability]));

function flattenText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join('；');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(flattenText).filter(Boolean).join('；');
  return '';
}

function candidate(
  abilityCode: string,
  input: Omit<EvidenceCandidate, 'abilityCode' | 'abilityName' | 'dimension'>,
): EvidenceCandidate | null {
  const ability = abilityByCode.get(abilityCode);
  return ability ? { ...input, abilityCode, abilityName: ability.name, dimension: ability.dimension } : null;
}

function resumeCandidates(section: {
  id: string;
  resumeId: string;
  resumeTitle: string;
  type: string;
  title: string;
  content: unknown;
  updatedAt: Date;
}): EvidenceCandidate[] {
  const content = flattenText(section.content).trim();
  if (!content) return [];
  const excerpt = content.slice(0, 500);
  const candidates: Array<EvidenceCandidate | null> = [];
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(content))) {
      candidates.push(candidate(rule.abilityCode, {
        sourceType: section.type === 'projects' ? 'project' : section.type === 'certifications' ? 'certificate' : 'resume',
        sourceId: `resume-section:${section.id}:${rule.abilityCode}`,
        title: `${section.resumeTitle} · ${section.title}`,
        excerpt,
        occurredAt: section.updatedAt,
      }));
    }
  }
  if (section.type === 'projects') {
    candidates.push(candidate('project_delivery', {
      sourceType: 'project',
      sourceId: `resume-section:${section.id}:project_delivery`,
      title: `${section.resumeTitle} · ${section.title}`,
      excerpt,
      occurredAt: section.updatedAt,
    }));
  }
  if (section.type === 'certifications') {
    candidates.push(candidate('continuous_learning', {
      sourceType: 'certificate',
      sourceId: `resume-section:${section.id}:continuous_learning`,
      title: `${section.resumeTitle} · ${section.title}`,
      excerpt,
      occurredAt: section.updatedAt,
    }));
  }
  return candidates.filter((item): item is EvidenceCandidate => item !== null);
}

async function persistCandidate(userId: string, item: EvidenceCandidate): Promise<boolean> {
  const existing = await db.select({ id: careerEvidence.id }).from(careerEvidence)
    .where(and(
      eq(careerEvidence.userId, userId),
      eq(careerEvidence.sourceType, item.sourceType),
      eq(careerEvidence.sourceId, item.sourceId),
      eq(careerEvidence.abilityCode, item.abilityCode),
    ))
    .limit(1);
  await db.insert(careerAbilities).values({
    userId,
    code: item.abilityCode,
    name: item.abilityName,
    dimension: item.dimension,
    score: item.score ?? null,
    confidence: item.score == null ? null : 70,
  } as never).onConflictDoUpdate({
    target: [careerAbilities.userId, careerAbilities.code],
    set: {
      name: item.abilityName,
      dimension: item.dimension,
      ...(item.score == null ? {} : { score: item.score, confidence: 70 }),
      updatedAt: new Date(),
    },
  });
  if (existing[0]) return false;
  await db.insert(careerEvidence).values({
    userId,
    abilityCode: item.abilityCode,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    title: item.title,
    excerpt: item.excerpt,
    status: 'pending',
    occurredAt: item.occurredAt,
  } as never).onConflictDoNothing();
  return true;
}

export async function syncCareerMaterials(userId: string): Promise<CareerMaterialSyncResult> {
  await dbReady;
  const sectionRows = await db.select({
    id: resumeSections.id,
    resumeId: resumes.id,
    resumeTitle: resumes.title,
    type: resumeSections.type,
    title: resumeSections.title,
    content: resumeSections.content,
    updatedAt: resumeSections.updatedAt,
  }).from(resumeSections)
    .innerJoin(resumes, eq(resumes.id, resumeSections.resumeId))
    .where(eq(resumes.userId, userId)) as Array<{
      id: string;
      resumeId: string;
      resumeTitle: string;
      type: string;
      title: string;
      content: unknown;
      updatedAt: Date;
    }>;
  const reportRows = await db.select({
    id: interviewReports.id,
    title: interviewSessions.jobTitle,
    score: interviewReports.overallScore,
    feedback: interviewReports.overallFeedback,
    createdAt: interviewReports.createdAt,
  }).from(interviewReports)
    .innerJoin(interviewSessions, eq(interviewSessions.id, interviewReports.sessionId))
    .where(eq(interviewSessions.userId, userId)) as Array<{
      id: string;
      title: string;
      score: number;
      feedback: string;
      createdAt: Date;
    }>;

  const candidates = sectionRows.flatMap(resumeCandidates);
  for (const report of reportRows) {
    const item = candidate('interview', {
      sourceType: 'interview',
      sourceId: `interview-report:${report.id}:interview`,
      title: `${report.title || '目标岗位'}模拟面试报告`,
      excerpt: report.feedback.slice(0, 500),
      occurredAt: report.createdAt,
      score: report.score,
    });
    if (item) candidates.push(item);
  }

  let evidenceCreated = 0;
  for (const item of candidates) {
    if (await persistCandidate(userId, item)) evidenceCreated += 1;
  }

  return {
    processedSources: sectionRows.length + reportRows.length,
    evidenceCreated,
    abilitiesLinked: new Set(candidates.map((item) => item.abilityCode)).size,
    warnings: candidates.length ? [] : ['未在现有简历或面试报告中识别到可结构化的能力材料。'],
    syncedAt: new Date().toISOString(),
  };
}
