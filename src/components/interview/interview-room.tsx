'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { UIMessage } from 'ai';
import { readJsonResponse } from '@/lib/http/json-client';
import { useRouter } from '@/i18n/routing';
import { useInterviewStore } from '@/stores/interview-store';
import { useInterviewChat } from '@/hooks/use-interview-chat';
import { useSettingsStore } from '@/stores/settings-store';
import { useCredits } from '@/hooks/use-credits';
import { ModelSelector } from '@/components/ai/model-selector';
import { INIT_TRIGGER } from '@/lib/interview/constants';
import { isRoundViewOnly } from '@/lib/interview/round-status';
import { ProgressBar } from './progress-bar';
import { InterviewerBanner } from './interviewer-banner';
import { MessageList } from './message-list';
import { MessageInput } from './message-input';
import { useInterviewControls } from './control-bar';
import { RoundTransition } from './round-transition';
import { ThinkingIndicator } from './thinking-indicator';
import type { InterviewerConfig } from '@/types/interview';

/** Convert DB messages to UIMessage format */
function dbMessagesToUIMessages(dbMessages: any[]): UIMessage[] {
  return dbMessages
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      id: m.id,
      role: m.role === 'interviewer' ? ('assistant' as const) : ('user' as const),
      parts: [{ type: 'text' as const, text: m.content }],
    }));
}

interface InterviewRoomProps {
  sessionId: string;
  initialMessages?: UIMessage[];
}

export function InterviewRoom({ sessionId, initialMessages }: InterviewRoomProps) {
  const t = useTranslations('interview.room');
  const router = useRouter();
  const { rounds, currentRoundIndex, setCurrentRoundIndex, advanceToNextRound, setIsGeneratingReport, status: sessionStatus } =
    useInterviewStore();
  const [showTransition, setShowTransition] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    () => useSettingsStore.getState().aiModel || undefined
  );

  const currentRound = rounds[currentRoundIndex];
  const interviewerConfig = currentRound?.interviewerConfig as InterviewerConfig;
  const isRoundDone = isRoundViewOnly(currentRound?.status, sessionStatus);

  const { messages, input, handleInputChange, handleSubmit, isLoading, status, error: chatError, resetMessages, sendMessage, setMessages } =
    useInterviewChat({
      sessionId,
      roundId: currentRound?.id || '',
      selectedModel,
    });

  const { refresh: refreshBalance } = useCredits();

  // Refresh balance after a successful streaming response completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === 'streaming' || prev === 'submitted') && status === 'ready') {
      refreshBalance();
    }
  }, [status, refreshBalance]);

  const encouragedAtRef = useRef(0);
  useEffect(() => {
    if (isLoading || isViewingHistory) return;
    const answerCount = messages.filter((message) => message.role === 'user').length;
    if (answerCount < 3 || answerCount % 3 !== 0 || answerCount === encouragedAtRef.current) return;
    encouragedAtRef.current = answerCount;
    const encouragements = t.raw('encouragements') as string[];
    toast.success(encouragements[(answerCount / 3 - 1) % encouragements.length]);
  }, [isLoading, isViewingHistory, messages, t]);

  // Show toast when AI API call fails — map known gateway error codes to specific messages
  const lastErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (chatError && chatError !== lastErrorRef.current) {
      lastErrorRef.current = chatError;
      const msg = chatError.message || '';
      if (msg.includes('INSUFFICIENT_CREDITS')) {
        toast.error(t('insufficientCredits'));
      } else if (msg.includes('RATE_LIMITED')) {
        toast.error(t('rateLimited'));
      } else if (msg.includes('MODEL_NOT_ALLOWED') || msg.includes('MODEL_NOT_FOUND')) {
        toast.error(t('modelNotAllowed'));
      } else if (msg.includes('ACCOUNT_SUSPENDED')) {
        toast.error(t('accountSuspended'));
      } else {
        toast.error(t('chatError'));
      }
    }
  }, [chatError, t]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    useSettingsStore.getState().setAIModel(modelId);
  }, []);

  // Load initial messages from DB on first render
  const loadedRef = useRef(false);
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0 && !loadedRef.current) {
      loadedRef.current = true;
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  // Auto-send trigger to start interview (only if no history and round is active)
  const sentInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      currentRound &&
      messages.length === 0 &&
      !isLoading &&
      !loadedRef.current &&
      !isViewingHistory &&
      !isRoundDone &&
      sentInitRef.current !== currentRound.id
    ) {
      sentInitRef.current = currentRound.id;
      sendMessage({ text: INIT_TRIGGER });
    }
  }, [currentRound?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set viewing history if round is already done
  useEffect(() => {
    if (currentRound && isRoundDone) {
      setIsViewingHistory(true);
      setShowTransition(false);
      loadedRef.current = true;
    }
  }, [currentRound?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect round completion
  useEffect(() => {
    if (!messages.length || isLoading || isViewingHistory) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    const text = lastMsg.parts?.find((p: any) => p.type === 'text');
    if ((text as any)?.text?.includes('[ROUND_COMPLETE]')) {
      setShowTransition(true);
    }
  }, [messages, isLoading, isViewingHistory]);

  // Switch round: load messages from API
  const handleSwitchRound = useCallback(async (index: number) => {
    const targetRound = rounds[index];
    if (!targetRound) return;

    setShowTransition(false);
    setCurrentRoundIndex(index);

    // Fetch messages for this round
    try {
      const res = await fetch(`/api/interview/${sessionId}`);
      const { rounds: roundsWithMessages } = await readJsonResponse<{ rounds: any[] }>(res);
      const roundData = roundsWithMessages.find((r: any) => r.id === targetRound.id);

      if (roundData?.messages?.length > 0) {
        setMessages(dbMessagesToUIMessages(roundData.messages));
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load round messages:', err);
      setMessages([]);
    }

    const isDone = isRoundViewOnly(targetRound.status, sessionStatus);
    setIsViewingHistory(isDone);
    if (isDone) setShowTransition(false);

    // Reset init refs
    loadedRef.current = true;
    sentInitRef.current = targetRound.id;
  }, [rounds, sessionId, sessionStatus, setCurrentRoundIndex, setMessages]);

  const handleNextRound = useCallback(() => {
    setShowTransition(false);
    setIsViewingHistory(false);
    advanceToNextRound();
    resetMessages();
    loadedRef.current = false;
    sentInitRef.current = null;
  }, [advanceToNextRound, resetMessages]);

  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    router.push(`/interview/${sessionId}/report`);
  }, [sessionId, router, setIsGeneratingReport]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');

  const handleTriggerAI = useCallback((text: string) => {
    sendMessage({ text });
  }, [sendMessage]);

  const handleEndRound = useCallback(() => {
    setShowTransition(true);
  }, []);

  const controls = useInterviewControls({
    sessionId,
    roundId: currentRound?.id ?? '',
    lastAssistantMessageId: lastAssistantMsg?.id,
    isLoading,
    onTriggerAI: handleTriggerAI,
    onEndRound: handleEndRound,
  });

  if (!currentRound) return null;

  const isLastRound = currentRoundIndex >= rounds.length - 1;

  if (showTransition && !isViewingHistory) {
    const nextRound = rounds[currentRoundIndex + 1];
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ProgressBar onSwitchRound={handleSwitchRound} />
        <RoundTransition
          nextInterviewer={(nextRound?.interviewerConfig as InterviewerConfig) || interviewerConfig}
          onContinue={isLastRound ? handleGenerateReport : handleNextRound}
          isLastRound={isLastRound}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 h-[calc(100dvh-120px)] md:h-[calc(100vh-180px)]">
      <ProgressBar onSwitchRound={handleSwitchRound} />
      <InterviewerBanner config={interviewerConfig} questionCount={messages.filter((m) => m.role === 'assistant').length} />
      <MessageList messages={messages} interviewerConfig={interviewerConfig} />
      {isLoading && (
        <div className="px-4">
          <ThinkingIndicator config={interviewerConfig} />
        </div>
      )}
      {isViewingHistory ? (
        <div className="border-t border-zinc-100 px-4 py-3 text-center text-sm text-zinc-400 dark:border-zinc-800">
          {t('roundComplete')}
        </div>
      ) : (
        <div className="space-y-2 border-t border-zinc-100 pt-2 pb-2 dark:border-zinc-800">
          {controls}
          <MessageInput
            input={input}
            isLoading={isLoading}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
          />
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            capability="text"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}
