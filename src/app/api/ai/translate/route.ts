import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { translateInputSchema } from '@/lib/ai/translate-schema';
import { extractJson } from '@/lib/ai/extract-json';
import { authorizeAiRequest } from '@/lib/ai/ai-authorization';
import { createHold, settleHold, releaseHold } from '@/lib/ai/credit-hold-service';
import { resolveProviderCredential } from '@/lib/crypto/credential-crypto';
import { buildModel, getJsonOptions } from '@/lib/ai/model-builder';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';
import { db } from '@/lib/db';
import { aiOperations, aiProviderAttempts, aiProviders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit, RATE_LIMIT_POLICIES, rateLimitKey } from '@/lib/rate-limit/rate-limit';
import { z } from 'zod/v4';

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
};

/** Fields to strip before sending to AI (e.g. base64 avatar), keyed by section type */
const STRIP_FIELDS: Record<string, string[]> = {
  personal_info: ['avatar'],
};

const MAX_CONCURRENCY = 4;

const singleSectionSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  content: z.any(),
});

function getSectionTranslatePrompt(targetLanguage: string): string {
  const langName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;

  return `You are a professional resume translator. Translate the given resume section into ${langName}.

Rules:
- Use professional, formal ${langName} appropriate for resumes
- Translate job titles, descriptions, and achievements naturally
- Keep proper nouns in their commonly recognized form. If no standard translation exists, keep original
- Dates remain in the same format (YYYY-MM)
- Technical terms and programming languages stay in English (e.g., JavaScript, React, AWS)
- Section titles should use standard resume headings in the target language
- Preserve the exact JSON structure and all field names — only translate string values
- Keep all IDs, URLs, emails, phone numbers unchanged
- CRITICAL: Return a single valid JSON object. No markdown, no code fences, no extra text.`;
}

/** Run async tasks with a concurrency limit */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onSettled?: (index: number, result: PromiseSettledResult<R>) => void
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        const r = await fn(items[i]);
        results[i] = { status: 'fulfilled', value: r };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
      onSettled?.(i, results[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  warnLegacyByok(request);
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parsed = translateInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { resumeId, targetLanguage, sectionIds, mode } = parsed.data;

  // AC1: Validate resumeId belongs to current user
  const resume = await resumeRepository.findById(resumeId);
  if (!resume) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }
  if (resume.userId !== ctx.context.actor.userId) {
    return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
  }

  // In copy mode, duplicate the resume first and translate the copy
  let targetResumeId = resumeId;
  let workingSections = resume.sections;
  let newResumeId: string | undefined;

  if (mode === 'copy') {
    const newTitle = `${resume.title}-${LANGUAGE_NAMES[targetLanguage] || targetLanguage}`;
    const duplicated = await resumeRepository.duplicate(resumeId, ctx.context.actor.userId, newTitle);
    if (!duplicated) {
      return NextResponse.json({ error: 'Failed to duplicate resume' }, { status: 500 });
    }
    targetResumeId = duplicated.id;
    workingSections = duplicated.sections;
    newResumeId = duplicated.id;
  }

  // AC1: Validate sectionIds ALL belong to this resume
  const allSections = sectionIds
    ? workingSections.filter((s: { id: string }) => sectionIds.includes(s.id))
    : workingSections;

  if (sectionIds && sectionIds.length > 0) {
    const foundIds = new Set(allSections.map((s: { id: string }) => s.id));
    const missingIds = sectionIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return NextResponse.json({ error: 'Resume not found' }, { status: 404 });
    }
  }

  if (allSections.length === 0) {
    return NextResponse.json({ error: 'No sections found to translate' }, { status: 400 });
  }

  // Build section data for AI, stripping heavy non-translatable fields
  const strippedFields = new Map<string, Record<string, unknown>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sectionsData = allSections.map((s: any) => {
    const fieldsToStrip = STRIP_FIELDS[s.type];
    let content = s.content;

    if (fieldsToStrip && content && typeof content === 'object') {
      const saved: Record<string, unknown> = {};
      content = { ...content };
      for (const field of fieldsToStrip) {
        if (field in content) {
          saved[field] = content[field];
          delete content[field];
        }
      }
      if (Object.keys(saved).length > 0) {
        strippedFields.set(s.id, saved);
      }
    }

    return {
      sectionId: s.id,
      type: s.type,
      title: s.title,
      content,
    };
  });

  // ── Gateway: authorize + create operation + create hold ──
  // AC5: Insufficient credits rejected before any concurrent provider call
  const authResult = await authorizeAiRequest({
    context: ctx.context,
    modelId: 'translate-default',
    capability: 'text',
  });
  if (!authResult.ok) {
    const statusMap: Record<string, number> = {
      AMBIGUOUS_BILLING: 400,
      ACCOUNT_FROZEN: 403,
      MODEL_NOT_ALLOWED: 403,
      CAPABILITY_NOT_SUPPORTED: 400,
    };
    return NextResponse.json(
      { error: authResult.error },
      { status: statusMap[authResult.error] ?? 500 }
    );
  }

  const { account, model } = authResult.data;

  // Rate limiting
  const rateKey = rateLimitKey('ai-gateway', 'user', ctx.context.actor.userId);
  const rateLimit = await checkRateLimit(rateKey, RATE_LIMIT_POLICIES.aiChat);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
      { status: 429 }
    );
  }

  // AC4: Idempotency — check for existing operation
  const idempotencyKey = `translate-${ctx.context.actor.userId}-${targetResumeId}-${targetLanguage}-${Date.now()}`;
  const existingOp = await db
    .select()
    .from(aiOperations)
    .where(eq(aiOperations.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingOp.length > 0) {
    return NextResponse.json(
      { error: 'OPERATION_EXISTS' },
      { status: 409 }
    );
  }

  // Create operation record
  const operationId = crypto.randomUUID();
  try {
    await db.insert(aiOperations).values({
      id: operationId,
      actorId: ctx.context.actor.userId,
      billingAccountId: account.id,
      capability: 'translate',
      status: 'in_progress',
      idempotencyKey,
    });
  } catch {
    return NextResponse.json(
      { error: 'OPERATION_EXISTS' },
      { status: 409 }
    );
  }

  // Create credit hold
  let holdId: string;
  try {
    const holdResult = await createHold({
      accountId: account.id,
      operationId,
      model,
      actorId: ctx.context.actor.userId,
      idempotencyKey: `hold-${idempotencyKey}`,
    });
    holdId = holdResult.hold.id;
  } catch (err) {
    await db.update(aiOperations)
      .set({ status: 'failed' })
      .where(eq(aiOperations.id, operationId));

    const error = err as Error;
    const isInsufficient = error.message.includes('Insufficient credits') || error.name === 'InsufficientCreditsError';
    return NextResponse.json(
      { error: isInsufficient ? 'INSUFFICIENT_CREDITS' : 'HOLD_FAILED' },
      { status: isInsufficient ? 422 : 500 }
    );
  }

  // Resolve provider credentials
  let apiKey: string;
  let baseUrl: string | null = null;
  let providerType: string;

  try {
    const provider = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, model.providerId))
      .limit(1);

    if (provider.length === 0) throw new Error('Provider not found');
    providerType = provider[0].type;
    baseUrl = provider[0].baseUrl;
    apiKey = resolveProviderCredential(model.providerId);
  } catch {
    await releaseHold({ holdId, reason: 'provider_failure' });
    await db.update(aiOperations)
      .set({ status: 'failed' })
      .where(eq(aiOperations.id, operationId));
    return NextResponse.json(
      { error: 'PROVIDER_CONFIG_ERROR' },
      { status: 503 }
    );
  }

  // ── NDJSON stream with concurrent translation ──
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        } catch {
          // Stream may have been cancelled by client
        }
      };

      let completed = 0;
      const total = sectionsData.length;
      let failedCount = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let attemptSeq = 0; // atomic counter for unique attempt numbers

      try {
        const results = await runWithConcurrency<
          typeof sectionsData[number],
          z.infer<typeof singleSectionSchema>
        >(
          sectionsData,
          MAX_CONCURRENCY,
          async (section) => {
            // AC2: Each provider request has independent attempt
            const attemptId = crypto.randomUUID();
            const startTime = Date.now();
            const thisAttemptNumber = ++attemptSeq; // atomic increment before async work

            await db.insert(aiProviderAttempts).values({
              id: attemptId,
              operationId,
              modelId: model.id,
              attemptNumber: thisAttemptNumber,
              status: 'in_progress',
            });

            try {
              const gwModel = buildModel({
                modelIdentifier: model.modelIdentifier,
                providerType,
                apiKey,
                baseUrl,
              });

              const aiResult = await generateText({
                model: gwModel,
                maxOutputTokens: 4096,
                system: getSectionTranslatePrompt(targetLanguage),
                prompt: `Translate this resume section. Return JSON with keys: sectionId, title, content.\n\n${JSON.stringify(section)}`,
                providerOptions: getJsonOptions(providerType),
              });

              const durationMs = Date.now() - startTime;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const usage: any = aiResult.usage ?? {};
              const inTok = usage.promptTokens ?? usage.inputTokens ?? 0;
              const outTok = usage.completionTokens ?? usage.outputTokens ?? 0;

              // Accumulate usage
              totalInputTokens += inTok;
              totalOutputTokens += outTok;

              // Update attempt with usage
              await db.update(aiProviderAttempts)
                .set({
                  status: 'succeeded',
                  durationMs,
                  completedAt: new Date(),
                  usage: {
                    inputTokens: inTok,
                    outputTokens: outTok,
                    totalTokens: usage.totalTokens ?? inTok + outTok,
                  },
                })
                .where(eq(aiProviderAttempts.id, attemptId));

              const translated = extractJson(aiResult.text, singleSectionSchema);

              // Merge back stripped fields (e.g. avatar)
              const saved = strippedFields.get(translated.sectionId);
              const content = saved
                ? { ...translated.content, ...saved }
                : translated.content;

              await resumeRepository.updateSection(translated.sectionId, {
                title: translated.title,
                content,
              });

              return { ...translated, content };
            } catch (err) {
              const durationMs = Date.now() - startTime;
              const errorMsg = err instanceof Error ? err.message.slice(0, 100) : 'Unknown error';

              await db.update(aiProviderAttempts)
                .set({
                  status: 'failed',
                  durationMs,
                  completedAt: new Date(),
                  errorMessage: errorMsg,
                })
                .where(eq(aiProviderAttempts.id, attemptId));

              throw err;
            }
          },
          (_index, result) => {
            completed++;
            if (result.status === 'rejected') {
              failedCount++;
              send({ type: 'progress', completed, total });
            } else {
              const section = (result as PromiseFulfilledResult<z.infer<typeof singleSectionSchema>>).value;
              send({ type: 'progress', completed, total, section });
            }
          }
        );

        if (failedCount > 0) {
          console.error(
            'Some sections failed to translate:',
            results
              .filter((r) => r.status === 'rejected')
              .map((f) => (f as PromiseRejectedResult).reason)
          );
        }

        // AC3: Settlement based on actual usage
        if (failedCount === total) {
          // All failed — release full hold
          await releaseHold({ holdId, reason: 'provider_failure' });
          await db.update(aiOperations)
            .set({ status: 'failed' })
            .where(eq(aiOperations.id, operationId));
        } else {
          // Partial or full success — settle with actual usage
          await settleHold({
            holdId,
            actualUsage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: totalInputTokens + totalOutputTokens,
            },
          });
          await db.update(aiOperations)
            .set({ status: 'succeeded' })
            .where(eq(aiOperations.id, operationId));
        }

        // Update resume language
        await resumeRepository.update(targetResumeId, { language: targetLanguage });
      } catch (err) {
        console.error('Unexpected error during translation:', err);
        // Release hold on unexpected error
        try {
          await releaseHold({ holdId, reason: 'provider_failure' });
        } catch { /* already released */ }
        await db.update(aiOperations)
          .set({ status: 'failed' })
          .where(eq(aiOperations.id, operationId));
      }

      // Always send done — even if something above threw
      try {
        const updatedResume = await resumeRepository.findById(targetResumeId);
        const updatedSections = sectionIds
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? updatedResume?.sections.filter((s: any) => sectionIds.includes(s.id))
          : updatedResume?.sections;

        send({
          type: 'done',
          resumeId: targetResumeId,
          language: targetLanguage,
          sections: updatedSections || [],
          failedCount,
          ...(newResumeId ? { newResumeId } : {}),
        });
      } catch (err) {
        console.error('Error fetching final data:', err);
        send({ type: 'done', resumeId: targetResumeId, language: targetLanguage, sections: [], failedCount, ...(newResumeId ? { newResumeId } : {}) });
      }

      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
