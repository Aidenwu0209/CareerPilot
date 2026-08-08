import { NextRequest, NextResponse } from 'next/server';
import { streamText, convertToModelMessages } from 'ai';
import { resolveActiveContext } from '@/lib/auth/guards';
import { interviewRepository } from '@/lib/db/repositories/interview.repository';
import { resumeRepository } from '@/lib/db/repositories/resume.repository';
import { buildInterviewSystemPrompt } from '@/lib/ai/interview-prompts';
import { executeStreamingOperation } from '@/lib/ai/gateway';
import { buildModel } from '@/lib/ai/model-builder';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveActiveContext();
  if (ctx === null) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  if (!ctx.ok) return ctx.response;

  const { id: sessionId } = await params;

  // AC1: Verify session belongs to the current user
  const session = await interviewRepository.findSession(sessionId);
  if (!session || session.userId !== ctx.context.actor.userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { messages, roundId, locale = 'zh' } = await request.json();

  // AC1: Verify round belongs to this session
  const round = await interviewRepository.findRound(roundId);
  if (!round || round.sessionId !== sessionId) {
    return NextResponse.json({ error: 'Round not found' }, { status: 404 });
  }

  // Optional: Load resume content if session has a resumeId
  let resumeContent: string | undefined;
  if (session.resumeId) {
    const resume = await resumeRepository.findById(session.resumeId as string);
    if (resume) {
      resumeContent = JSON.stringify(resume.sections);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const interviewerConfig = round.interviewerConfig as any;

  // Save candidate message
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'user') {
      const textPart = lastMessage.parts?.find((p: { type: string }) => p.type === 'text');
      const content = textPart?.text || lastMessage.content || '';
      if (content) {
        await interviewRepository.addMessage({
          roundId,
          role: 'candidate',
          content,
        });
      }
    }
  }

  const modelMessages = await convertToModelMessages(messages);

  if (round.status === 'pending') {
    await interviewRepository.updateRoundStatus(roundId, 'in_progress');
    await interviewRepository.updateSessionStatus(sessionId, 'in_progress');
  }

  const systemPrompt = buildInterviewSystemPrompt({
    interviewer: interviewerConfig,
    jobDescription: session.jobDescription,
    resumeContent,
    maxQuestions: round.maxQuestions,
    locale,
  });

  // AC2: Execute through streaming gateway (pre-flight hold before first byte)
  const result = await executeStreamingOperation({
    context: ctx.context,
    modelId: 'interview-chat-default',
    capability: 'text',
    businessCapability: 'interview_chat',
    idempotencyKey: `interview-chat-${ctx.context.actor.userId}-${sessionId}-${roundId}-${Date.now()}`,
    dispatch: async (gwCtx) => {
      const model = buildModel(gwCtx);

      // Cache usage for the monitoring layer to pick up
      let cachedUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;

      const aiResult = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
        onFinish: async ({ text, usage }) => {
          // Cache usage for the gateway monitoring layer
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const u: any = usage ?? {};
          cachedUsage = {
            inputTokens: u.promptTokens ?? u.inputTokens,
            outputTokens: u.completionTokens ?? u.outputTokens,
            totalTokens: u.totalTokens,
          };

          if (!text) return;

          // AC4: Save interviewer message and update round lifecycle
          await interviewRepository.addMessage({
            roundId,
            role: 'interviewer',
            content: text,
          });

          await interviewRepository.incrementQuestionCount(roundId);

          if (text.includes('[ROUND_COMPLETE]')) {
            await interviewRepository.updateRoundStatus(roundId, 'completed');
            await interviewRepository.setRoundSummary(roundId, {
              score: 0,
              feedback: text.replace('[ROUND_COMPLETE]', '').trim(),
            });

            const rounds = await interviewRepository.findRoundsBySessionId(sessionId);
            const currentIndex = rounds.findIndex((r: { id: string }) => r.id === roundId);
            const nextRound = rounds[currentIndex + 1];

            if (nextRound) {
              await interviewRepository.updateSessionRound(sessionId, currentIndex + 1);
            } else {
              await interviewRepository.updateSessionStatus(sessionId, 'completed');
            }
          }
        },
      });

      const stream = aiResult.toUIMessageStream() as unknown as ReadableStream<Uint8Array>;

      return {
        stream,
        getUsage: async () => {
          // Wait for cached usage to be available (onFinish fires before stream closes)
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

  // Return the monitored stream
  return new Response(result.stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
