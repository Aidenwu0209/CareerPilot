import 'server-only';

import { desc, eq, max } from 'drizzle-orm';
import { generateText } from 'ai';
import { z } from 'zod';
import type { RequestContext } from '@/lib/auth/context';
import { executeAiOperation } from '@/lib/ai/gateway';
import { buildModel, getJsonOptions } from '@/lib/ai/model-builder';
import { getCareerReportPrompt, getCareerReportSystemPrompt } from '@/lib/ai/prompts';
import { extractJson } from '@/lib/ai/extract-json';
import { db } from '@/lib/db';
import { careerReportVersions } from '@/lib/db/schema';
import { buildCareerReportMarkdown } from './report';
import { getCareerSelfAssessment } from './self-assessment-service';
import { getCareerMatch, getCareerOverview, getCareerPath } from './service';

const outputSchema = z.object({
  title: z.string().min(2).max(160),
  summary: z.string().min(20).max(3000),
  sections: z.array(z.object({ heading: z.string().min(1).max(120), markdown: z.string().min(1).max(12000) })).min(3).max(12),
});

const REQUIRED_SECTIONS = [
  { key: 'goal', words: ['目标', 'goal', 'objective'] },
  { key: 'metrics', words: ['指标', 'metric', 'readiness'] },
  { key: 'self', words: ['自我', '测评', 'self', 'assessment'] },
  { key: 'path', words: ['路径', '阶段', 'path', 'roadmap'] },
  { key: 'match', words: ['匹配', '差距', 'match', 'gap'] },
  { key: 'actions', words: ['行动', '建议', 'action', 'next step'] },
];

export function checkReportCompleteness(markdown: string) {
  const headings = markdown.split('\n').filter((line) => /^#{1,3}\s/.test(line)).map((line) => line.replace(/^#{1,3}\s*/, '').trim());
  const missingSections = REQUIRED_SECTIONS.filter((section) => !headings.some((heading) => {
    const normalized = heading.toLowerCase();
    return section.words.some((word) => normalized.includes(word));
  })).map((section) => ({ keyword: section.key, message: `Missing report section: ${section.key}.` }));
  return { complete: missingSections.length === 0, headings, missingSections };
}

async function sourceMarkdown(userId: string, locale: string) {
  const [overview, path, assessment] = await Promise.all([
    getCareerOverview(userId), getCareerPath(userId), getCareerSelfAssessment(userId),
  ]);
  const match = overview.primaryGoal ? await getCareerMatch(userId, overview.primaryGoal.occupationCode) : null;
  return buildCareerReportMarkdown({ overview, path, assessment, match }, locale);
}

function renderOutput(value: z.infer<typeof outputSchema>) {
  return [`# ${value.title}`, '', value.summary, '', ...value.sections.flatMap((section) => [`## ${section.heading}`, '', section.markdown, ''])].join('\n').trim();
}

async function nextVersion(userId: string) {
  const [row] = await db.select({ value: max(careerReportVersions.version) }).from(careerReportVersions)
    .where(eq(careerReportVersions.userId, userId));
  return Number(row?.value ?? 0) + 1;
}

export async function listCareerReportVersions(userId: string) {
  return db.select().from(careerReportVersions).where(eq(careerReportVersions.userId, userId))
    .orderBy(desc(careerReportVersions.version)).limit(50);
}

export async function generateCareerReport(params: {
  context: RequestContext;
  modelId: string;
  locale: string;
  mode?: 'generate' | 'polish';
  sourceVersionId?: string;
}) {
  const userId = params.context.actor.userId;
  let source = await sourceMarkdown(userId, params.locale);
  if (params.mode === 'polish' && params.sourceVersionId) {
    const [existing] = await db.select().from(careerReportVersions).where(eq(careerReportVersions.id, params.sourceVersionId)).limit(1);
    if (!existing || existing.userId !== userId) throw new Error('REPORT_NOT_FOUND');
    source = existing.markdown;
  }
  const result = await executeAiOperation({
    context: params.context,
    modelId: params.modelId,
    capability: 'text',
    businessCapability: params.mode === 'polish' ? 'career_report_polish' : 'career_report_generate',
    idempotencyKey: `career-report:${params.mode ?? 'generate'}:${userId}:${params.sourceVersionId ?? Date.now()}`,
    dispatch: async (gateway) => {
      const aiResult = await generateText({
        model: buildModel(gateway), maxOutputTokens: 12000,
        system: getCareerReportSystemPrompt(params.locale),
        prompt: getCareerReportPrompt(source, params.locale, params.mode ?? 'generate'),
        providerOptions: getJsonOptions(gateway.providerType),
      });
      return { text: aiResult.text, usage: aiResult.usage };
    },
  });
  if (!result.ok) return result;
  const parsed = extractJson(result.data.text, outputSchema);
  const markdown = renderOutput(parsed);
  const completeness = checkReportCompleteness(markdown);
  const version = await nextVersion(userId);
  const id = crypto.randomUUID();
  await db.insert(careerReportVersions).values({
    id, userId, version, title: parsed.title, markdown,
    status: completeness.complete ? 'complete' : 'draft', completeness,
    sourceVersionId: params.sourceVersionId ?? null, aiOperationId: result.operationId,
  } as never);
  const [saved] = await db.select().from(careerReportVersions).where(eq(careerReportVersions.id, id)).limit(1);
  return { ok: true as const, data: saved, operationId: result.operationId, attemptId: result.attemptId };
}
