import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { analysisRepository } from '@/lib/db/repositories/analysis.repository';
import { grammarCheckInputSchema, grammarCheckOutputSchema } from '@/lib/ai/grammar-check-schema';
import { extractJson } from '@/lib/ai/extract-json';
import { executeAiOperation } from '@/lib/ai/gateway';
import { buildModel, getJsonOptions } from '@/lib/ai/model-builder';

const GRAMMAR_CHECK_PROMPT = `You are an expert resume reviewer and writing coach. Analyze the provided resume sections for writing quality issues.

IMPORTANT: Detect the primary language of the resume content. You MUST respond entirely in the same language as the resume. If the resume is written in Chinese, all your output (summary, suggestions, sectionTitle) must be in Chinese. If in English, respond in English. Match the resume's language exactly.

You must detect and report these types of issues:
- grammar: Grammatical errors, incorrect tense, subject-verb disagreement, article misuse
- spelling: Misspelled words or typos
- weak_verb: Weak or passive verbs that should be replaced with strong action verbs
- vague: Vague or generic descriptions that lack specificity
- quantify: Descriptions that could be improved with quantifiable metrics

Analysis guidelines:
- Check every text field in every section: titles, descriptions, highlights, summary text
- For each issue, provide the exact original text and a concrete suggestion
- Set severity: "high" for grammar/spelling errors, "medium" for weak verbs and vague descriptions, "low" for quantify suggestions
- Be thorough but practical — only flag genuinely improvable items
- Provide a brief overall summary of the writing quality
- Assign a score from 0-100 (100 = perfect, no issues found)

You MUST return a JSON object with exactly these fields:
- issues: array of { sectionId, sectionTitle, type, original, suggestion, severity }
- summary: string with overall assessment
- score: number from 0 to 100

CRITICAL: You are a JSON API. Your entire response must be a single valid JSON object starting with { and ending with }. Do NOT use markdown syntax. Do NOT wrap in code fences. Do NOT add any text before or after the JSON.`;

export async function POST(request: NextRequest) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = grammarCheckInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { resumeId, sectionIds } = parsed.data;

  // Fetch the resume and verify ownership
  const resume = await resumeRepository.findById(resumeId);
  if (!resume) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }
  if (resume.userId !== ctx.context.actor.userId) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }

  // Filter sections if specific IDs are provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sectionsToCheck = sectionIds
    ? resume.sections.filter((s: any) => sectionIds.includes(s.id))
    : resume.sections;

  if (sectionsToCheck.length === 0) {
    return NextResponse.json({ error: 'No sections found to check' }, { status: 400 });
  }

  // Prepare sections data for AI analysis
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sectionsData = sectionsToCheck.map((s: any) => ({
    sectionId: s.id,
    sectionTitle: s.title,
    type: s.type,
    content: s.content,
  }));

  // Execute through unified gateway
  const result = await executeAiOperation({
    context: ctx.context,
    modelId: 'grammar-check-default',
    capability: 'text',
    businessCapability: 'grammar_check',
    idempotencyKey: `grammar-${ctx.context.actor.userId}-${resumeId}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const model = buildModel(gwCtx);
      const aiResult = await generateText({
        model,
        maxOutputTokens: 8192,
        system: GRAMMAR_CHECK_PROMPT,
        prompt: `Analyze the following resume sections. Respond with JSON only.\n\n${JSON.stringify(sectionsData, null, 2)}`,
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

  const checkResult = extractJson(result.data.text, grammarCheckOutputSchema);

  // Persist to database
  let historyId: string | undefined;
  try {
    const saved = await analysisRepository.createGrammarCheck({
      resumeId,
      result: checkResult,
      score: checkResult.score,
      issueCount: checkResult.issues.length,
    });
    historyId = saved?.id;
  } catch (e) {
    console.error('Failed to save grammar check history:', e);
  }

  return NextResponse.json({ ...checkResult, historyId });
}
