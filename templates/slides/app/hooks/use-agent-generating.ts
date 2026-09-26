import {
  sendToAgentChatAndConfirm,
  useAgentChatGenerating,
  useAgentEngineConfigured,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// A long deck may run for hours while its chat stream, tools, or slides keep
// making progress. Only a quiet run is considered stuck.
export const GENERATION_NO_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;

// Gateway continuations can briefly report a stopped chat between model/tool
// chunks. Keep generation UI and presence steady across that transport gap.
export const CHAT_STOP_DEBOUNCE_MS = 4_000;
const CHAT_SUBMIT_TARGET_EVENT = "agentNative.chatSubmitTarget";
export const SLIDES_GENERATION_STARTED_EVENT = "slides:generation-started";
const startedGenerationAttempts = new Map<string, string>();

function generationAttemptKey(attemptId: string, outputId: string): string {
  return `${attemptId}:${outputId}`;
}

export function hasStartedGenerationAttempt(
  attemptId: string,
  outputId: string,
): boolean {
  return startedGenerationAttempts.has(
    generationAttemptKey(attemptId, outputId),
  );
}

export function getStartedGenerationAttemptTabId(
  attemptId: string,
  outputId: string,
): string | null {
  return (
    startedGenerationAttempts.get(generationAttemptKey(attemptId, outputId)) ??
    null
  );
}

export function clearStartedGenerationAttempt(
  attemptId: string,
  outputId: string,
): void {
  startedGenerationAttempts.delete(generationAttemptKey(attemptId, outputId));
}

function recordStartedGenerationAttempt(
  attemptId: string,
  outputId: string,
  tabId: string,
): void {
  startedGenerationAttempts.set(
    generationAttemptKey(attemptId, outputId),
    tabId,
  );
  window.dispatchEvent(
    new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
      detail: { generationAttemptId: attemptId, outputId, tabId },
    }),
  );
}

type AgentGeneratingSubmitOptions = Pick<
  AgentChatMessage,
  | "newTab"
  | "openSidebar"
  | "referenceImagePaths"
  | "images"
  | "model"
  | "engine"
  | "effort"
  | "submitMessageId"
> & {
  reuseEmptyTab?: boolean;
  attachments?: ReadonlyArray<unknown>;
  generationAttemptId?: string;
  generationOutputId?: string;
};

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook, with a timeout
 * fallback so a run that never reports completion can't spin forever.
 */
export function useAgentGenerating(options?: {
  tabId: string | null;
  progressToken?: number;
}) {
  const hasTabScope = options !== undefined;
  const scopedTabId = options?.tabId ?? null;
  const progressToken = options?.progressToken;
  const [generating, send, stopReason, observedRun] = useAgentChatGenerating(
    hasTabScope ? { tabId: scopedTabId } : undefined,
  );
  const engineConfigured = useAgentEngineConfigured();
  const [recentlyGenerating, setRecentlyGenerating] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [runError, setRunError] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSubmitRef = useRef<string | null>(null);
  const activeGenerationAttemptRef = useRef<{
    attemptId: string;
    outputId: string;
    submitMessageId: string;
  } | null>(null);
  const scopedTabIdRef = useRef<string | null>(scopedTabId);
  scopedTabIdRef.current = scopedTabId;
  const activeTabRef = useRef<string | null>(scopedTabId);
  const generationActiveRef = useRef(false);
  generationActiveRef.current = generating || recentlyGenerating;
  const lastProgressTokenRef = useRef(progressToken);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearStopDebounce = useCallback(() => {
    if (stopDebounceRef.current !== null) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }
  }, []);

  const resetWatchdog = useCallback(() => {
    clearWatchdog();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setTimedOut(true);
    }, GENERATION_NO_PROGRESS_TIMEOUT_MS);
  }, [clearWatchdog]);

  const providerMissing = engineConfigured.state === "missing";

  useEffect(() => {
    if (!hasTabScope) return;
    activeTabRef.current = scopedTabId;
    activeSubmitRef.current = null;
    clearStopDebounce();
    clearWatchdog();
    setRecentlyGenerating(false);
    setTimedOut(false);
    setRunError(false);
  }, [clearStopDebounce, clearWatchdog, hasTabScope, scopedTabId]);

  useEffect(() => {
    if (!providerMissing) return;
    clearStopDebounce();
    clearWatchdog();
    setRecentlyGenerating(false);
    setTimedOut(false);
    setRunError(false);
  }, [clearStopDebounce, clearWatchdog, providerMissing]);

  useEffect(() => {
    const targetHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.submitMessageId !== activeSubmitRef.current ||
        typeof detail?.tabId !== "string"
      ) {
        return;
      }
      activeTabRef.current = detail.tabId;
      const generationAttempt = activeGenerationAttemptRef.current;
      if (
        generationAttempt &&
        generationAttempt.submitMessageId === detail.submitMessageId
      ) {
        recordStartedGenerationAttempt(
          generationAttempt.attemptId,
          generationAttempt.outputId,
          detail.tabId,
        );
      }
    };
    const errorHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const eventTabId =
        typeof detail?.tabId === "string" ? detail.tabId : null;
      if (
        !generationActiveRef.current ||
        !eventTabId ||
        !activeTabRef.current ||
        eventTabId !== activeTabRef.current ||
        typeof detail?.message !== "string"
      ) {
        return;
      }
      activeSubmitRef.current = null;
      activeTabRef.current = null;
      clearStopDebounce();
      clearWatchdog();
      setRecentlyGenerating(false);
      setTimedOut(false);
      setRunError(true);
      toast.error(detail.message, {
        id:
          typeof detail.runId === "string"
            ? detail.runId
            : `agent-run-error-${eventTabId}`,
      });
    };
    const runningHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.isRunning !== false ||
        !activeTabRef.current ||
        detail?.tabId !== activeTabRef.current
      ) {
        return;
      }
      if (scopedTabIdRef.current) return;
      activeSubmitRef.current = null;
      activeTabRef.current = null;
    };

    window.addEventListener(CHAT_SUBMIT_TARGET_EVENT, targetHandler);
    window.addEventListener("agent-chat:run-error", errorHandler);
    window.addEventListener("agentNative.chatRunning", runningHandler);
    return () => {
      window.removeEventListener(CHAT_SUBMIT_TARGET_EVENT, targetHandler);
      window.removeEventListener("agent-chat:run-error", errorHandler);
      window.removeEventListener("agentNative.chatRunning", runningHandler);
    };
  }, [clearStopDebounce, clearWatchdog]);

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        !generationActiveRef.current ||
        typeof detail?.tabId !== "string" ||
        detail.tabId !== activeTabRef.current
      ) {
        return;
      }
      setTimedOut(false);
      resetWatchdog();
    };

    window.addEventListener("agent-chat:stream-progress", handleProgress);
    window.addEventListener("agent-chat:activity", handleProgress);
    return () => {
      window.removeEventListener("agent-chat:stream-progress", handleProgress);
      window.removeEventListener("agent-chat:activity", handleProgress);
    };
  }, [resetWatchdog]);

  useEffect(() => {
    if (lastProgressTokenRef.current === progressToken) return;
    lastProgressTokenRef.current = progressToken;
    if (!generationActiveRef.current) return;
    setTimedOut(false);
    resetWatchdog();
  }, [progressToken, resetWatchdog]);

  useEffect(() => {
    if (runError) {
      clearStopDebounce();
      clearWatchdog();
      return clearStopDebounce;
    }
    if (stopReason === "stopped") {
      clearStopDebounce();
      clearWatchdog();
      setRecentlyGenerating(false);
      setTimedOut(false);
      return clearStopDebounce;
    }
    if (generating) {
      if (hasTabScope && timeoutRef.current === null) resetWatchdog();
      clearStopDebounce();
      setRecentlyGenerating(true);
    } else if (recentlyGenerating) {
      clearStopDebounce();
      stopDebounceRef.current = setTimeout(() => {
        stopDebounceRef.current = null;
        setRecentlyGenerating(false);
      }, CHAT_STOP_DEBOUNCE_MS);
    }

    if (!generating && !recentlyGenerating) {
      clearWatchdog();
      setTimedOut(false);
    }

    return clearStopDebounce;
  }, [
    generating,
    recentlyGenerating,
    stopReason,
    runError,
    hasTabScope,
    clearStopDebounce,
    clearWatchdog,
    resetWatchdog,
  ]);

  useEffect(
    () => () => {
      clearWatchdog();
      clearStopDebounce();
    },
    [clearStopDebounce, clearWatchdog],
  );

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: AgentGeneratingSubmitOptions,
    ) => {
      const {
        generationAttemptId,
        generationOutputId,
        submitMessageId: requestedSubmitMessageId,
        ...agentOptions
      } = options ?? {};
      const submitMessageId =
        requestedSubmitMessageId ??
        `slides-submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setTimedOut(false);
      setRunError(false);
      resetWatchdog();
      activeSubmitRef.current = submitMessageId;
      activeGenerationAttemptRef.current =
        generationAttemptId && generationOutputId
          ? {
              attemptId: generationAttemptId,
              outputId: generationOutputId,
              submitMessageId,
            }
          : null;
      activeTabRef.current = null;
      const returnedTabId = send({
        message,
        context,
        submit: true,
        submitMessageId,
        ...agentOptions,
      } as AgentChatMessage & { attachments?: ReadonlyArray<unknown> });
      activeTabRef.current ??= returnedTabId;
      if (
        generationAttemptId &&
        generationOutputId &&
        activeTabRef.current &&
        typeof window !== "undefined"
      ) {
        recordStartedGenerationAttempt(
          generationAttemptId,
          generationOutputId,
          activeTabRef.current,
        );
      }
    },
    [send, resetWatchdog],
  );

  const submitAndConfirm = useCallback(
    (
      message: string,
      context: string,
      options?: AgentGeneratingSubmitOptions,
    ) => {
      const {
        generationAttemptId,
        generationOutputId,
        submitMessageId: requestedSubmitMessageId,
        ...agentOptions
      } = options ?? {};
      const submitMessageId =
        requestedSubmitMessageId ??
        `slides-submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setTimedOut(false);
      setRunError(false);
      resetWatchdog();
      activeSubmitRef.current = submitMessageId;
      activeTabRef.current = null;
      const submission = sendToAgentChatAndConfirm(
        {
          message,
          context,
          submit: true,
          submitMessageId,
          chatTarget: "local",
          ...agentOptions,
        } as AgentChatMessage & { attachments?: ReadonlyArray<unknown> },
        { submitMessageId },
      );
      void submission.then(({ tabId, delivered }) => {
        if (!delivered) {
          if (activeSubmitRef.current === submitMessageId) {
            activeSubmitRef.current = null;
            activeTabRef.current = null;
            clearWatchdog();
            setRecentlyGenerating(false);
            setTimedOut(false);
            setRunError(false);
          }
          return;
        }
        const targetTabId = activeTabRef.current ?? tabId;
        activeTabRef.current = targetTabId;
        if (
          generationAttemptId &&
          generationOutputId &&
          typeof window !== "undefined"
        ) {
          startedGenerationAttempts.set(
            generationAttemptKey(generationAttemptId, generationOutputId),
            targetTabId,
          );
          window.dispatchEvent(
            new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
              detail: {
                generationAttemptId,
                outputId: generationOutputId,
                tabId: targetTabId,
              },
            }),
          );
        }
      });
      return submission;
    },
    [clearWatchdog],
  );

  return {
    generating:
      !providerMissing &&
      stopReason !== "stopped" &&
      (generating || recentlyGenerating) &&
      !timedOut &&
      !runError,
    runError,
    stopReason,
    observedRun,
    timedOut,
    submit,
    submitAndConfirm,
  };
}
