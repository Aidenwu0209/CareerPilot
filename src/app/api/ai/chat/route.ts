import { NextRequest, NextResponse } from 'next/server';
import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { chatRepository } from '@/lib/db/repositories/chat.repository';
import { getSystemPrompt } from '@/lib/ai/prompts';
import { createExecutableTools } from '@/lib/ai/tools';
import { validateChatMessages, sanitizedError, MAX_AI_STEPS } from '@/lib/validation/input-limits';
import { executeStreamingOperation } from '@/lib/ai/gateway';
import { buildModel } from '@/lib/ai/model-builder';
import { warnLegacyByok } from '@/lib/ai/legacy-detect';

const MAX_ROUNDS = 10;
const MAX_MESSAGES = MAX_ROUNDS * 2;

export async function POST(request: NextRequest) {
  warnLegacyByok(request);
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const { messages, resumeId, sessionId } = await request.json();

  // Validate message count and per-message length
  if (Array.isArray(messages)) {
    const msgCheck = validateChatMessages(messages);
    if (!msgCheck.ok) {
      return sanitizedError(msgCheck.error);
    }
  }

  // AC3: Verify resumeId ownership before loading any data
  let resumeContext = '';
  let verifiedResumeId: string | null = null;
  if (resumeId) {
    const resume = await resumeRepository.findById(resumeId);
    if (!resume || resume.userId !== ctx.context.actor.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    verifiedResumeId = resume.id;
    resumeContext = JSON.stringify(resume.sections);
  }

  // Verify sessionId belongs to the user's resume
  if (sessionId) {
    const session = await chatRepository.findSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (resumeId && session.resumeId !== resumeId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (session.resumeId !== verifiedResumeId) {
      const sessionResume = await resumeRepository.findById(session.resumeId);
      if (!sessionResume || sessionResume.userId !== ctx.context.actor.userId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
  }

  // Save user message to DB before streaming
  if (sessionId && messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
      const textPart = lastMessage.parts?.find((p: { type: string }) => p.type === 'text');
      const content = textPart?.text || lastMessage.content || '';
      if (content) {
        const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
        if (userMessages.length === 1) {
          const title = content.slice(0, 50);
          await chatRepository.updateSessionTitle(sessionId, title);
        }

        await chatRepository.addMessage({
          sessionId,
          role: 'user',
          content,
        });
      }
    }
  }

  const modelMessages = await convertToModelMessages(messages);
  const truncatedMessages = modelMessages.slice(-MAX_MESSAGES);

  // AC1+AC2: Execute through streaming gateway (pre-flight hold before first byte)
  const result = await executeStreamingOperation({
    context: ctx.context,
    modelId: 'resume-chat-default',
    capability: 'text',
    businessCapability: 'resume_chat',
    idempotencyKey: `resume-chat-${ctx.context.actor.userId}-${sessionId ?? 'no-session'}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const model = buildModel(gwCtx);

      // AC3: Tools only operate on verified resumeId
      const tools = verifiedResumeId
        ? createExecutableTools(verifiedResumeId, {
            providerType: gwCtx.providerType,
            apiKey: gwCtx.apiKey,
            baseUrl: gwCtx.baseUrl,
            modelIdentifier: gwCtx.modelIdentifier,
          })
        : undefined;

      let cachedUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

      const aiResult = streamText({
        model,
        system: getSystemPrompt(resumeContext),
        messages: truncatedMessages,
        tools,
        stopWhen: tools ? stepCountIs(MAX_AI_STEPS) : undefined,
        onFinish: async ({ text, steps, usage }) => {
          // Cache usage for gateway monitoring
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const u: any = usage ?? {};
          cachedUsage = {
            inputTokens: u.promptTokens ?? u.inputTokens,
            outputTokens: u.completionTokens ?? u.outputTokens,
            totalTokens: u.totalTokens,
          };

          if (!sessionId) return;

          // Build ordered parts array
          const orderedParts: ({ type: 'text'; text: string } | { type: 'tool'; toolName: string; args: unknown; result: unknown })[] = [];

          for (const step of steps) {
            if (step.text) {
              orderedParts.push({ type: 'text', text: step.text });
            }
            const tcs = step.toolCalls ?? [];
            const trs = step.toolResults ?? [];
            for (let i = 0; i < tcs.length; i++) {
              orderedParts.push({
                type: 'tool',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                toolName: (tcs[i] as any).toolName,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                args: (tcs[i] as any).input,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result: (trs[i] as any)?.output,
              });
            }
          }

          const fullText = text || '';
          if (fullText || orderedParts.some((p) => p.type === 'tool')) {
            await chatRepository.addMessage({
              sessionId,
              role: 'assistant',
              content: fullText,
              metadata: orderedParts.length > 0 ? { orderedParts } : {},
            });
          }
        },
      });

      const stream = aiResult.toUIMessageStream() as unknown as ReadableStream<Uint8Array>;

      return {
        stream,
        getUsage: async () => {
          if (cachedUsage) return cachedUsage;
          return { totalTokens: 0 };
        },
      };
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status }
    );
  }

  return new Response(result.stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
