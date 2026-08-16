import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { analysisRepository } from '@/lib/db/repositories/analysis.repository';
import { jdAnalysisInputSchema, jdAnalysisOutputSchema } from '@/lib/ai/jd-analysis-schema';
import { extractJson } from '@/lib/ai/extract-json';
import { executeAiOperation } from '@/lib/ai/gateway';
import { buildModel, getJsonOptions } from '@/lib/ai/model-builder';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';
import { logger } from '@/lib/observability/logger';

const JD_ANALYSIS_PROMPT = `You are an expert resume analyst and career coach. Analyze the match between the provided resume and job description.

IMPORTANT: Detect the primary language of the resume content. You MUST respond entirely in the same language as the resume. If the resume is written in Chinese, all your output (summary, suggestions, keywords) must be in Chinese. If in English, respond in English. Match the resume's language exactly.

Your analysis should be thorough and actionable. You MUST return a JSON object with these exact fields:
- overallScore (number 0-100): Overall match rating
- keywordMatches (string[]): Keywords from the JD that ARE present in the resume
- missingKeywords (string[]): Important keywords from the JD that are NOT in the resume
- suggestions (array of {section, current, suggested}): Actionable improvement suggestions
- atsScore (number 0-100): ATS compatibility rating
- summary (string): Concise overall assessment

CRITICAL: You are a JSON API. Your entire response must be a single valid JSON object starting with { and ending with }. Do NOT use markdown syntax. Do NOT wrap in code fences. Do NOT add any text before or after the JSON.`;

export async function POST(request: NextRequest) {
  await warnLegacyByok(request);
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = jdAnalysisInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { resumeId, jobDescription, model } = parsed.data;

  // Fetch the resume and verify ownership
  const resume = await resumeRepository.findById(resumeId);
  if (!resume) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }
  if (resume.userId !== ctx.context.actor.userId) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }

  const resumeContext = JSON.stringify(resume.sections);

  // Execute through unified gateway
  const result = await executeAiOperation({
    context: ctx.context,
    modelId: model || 'jd-analysis-default',
    capability: 'text',
    businessCapability: 'jd_analysis',
    idempotencyKey: `jd-analysis-${ctx.context.actor.userId}-${resumeId}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const model = buildModel(gwCtx);
      const aiResult = await generateText({
        model,
        maxOutputTokens: 8192,
        system: JD_ANALYSIS_PROMPT,
        prompt: `Resume:\n${resumeContext}\n\nJob Description:\n${jobDescription}\n\nRespond with JSON only.`,
        providerOptions: getJsonOptions(gwCtx.providerType),
      });
      return { text: aiResult.text, usage: aiResult.usage };
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status }
    );
  }

  const analysisData = extractJson(result.data.text, jdAnalysisOutputSchema);

  // Persist to database
  let historyId: string | undefined;
  try {
    const saved = await analysisRepository.createJdAnalysis({
      resumeId,
      jobDescription,
      result: analysisData,
      overallScore: analysisData.overallScore,
      atsScore: analysisData.atsScore,
    });
    historyId = saved?.id;
  } catch (e) {
    logger.error('ai.jd_history_save_failed', { error: e, resumeId });
  }

  return NextResponse.json({ ...analysisData, historyId });
}
