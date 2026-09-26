import {
  sendToAgentChatAndConfirm,
  useAgentChatGenerating,
  useAgentEngineConfigured,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const MAX_GENERATING_MS = 30 * 60 * 1000;

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

export function useAgentGenerating(options?: { tabId: string | null }) {
  const hasTabScope = options !== undefined;
  const scopedTabId = options?.tabId ?? null;
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
  const scopedTabIdRef = useRef<string | null>(scopedTabId);
  scopedTabIdRef.current = scopedTabId;
  const activeTabRef = useRef<string | null>(scopedTabId);
  const generationActiveRef = useRef(false);
  generationActiveRef.current = generating || recentlyGenerating;

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
      if (hasTabScope && timeoutRef.current === null) {
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          setTimedOut(true);
        }, MAX_GENERATING_MS);
      }
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
      clearWatchdog();
      timeoutRef.current = setTimeout(
        () => setTimedOut(true),
        MAX_GENERATING_MS,
      );
      activeSubmitRef.current = submitMessageId;
      activeTabRef.current = send({
        message,
        context,
        submit: true,
        submitMessageId,
        ...agentOptions,
      } as AgentChatMessage & { attachments?: ReadonlyArray<unknown> });
      if (
        generationAttemptId &&
        generationOutputId &&
        activeTabRef.current &&
        typeof window !== "undefined"
      ) {
        startedGenerationAttempts.set(
          generationAttemptKey(generationAttemptId, generationOutputId),
          activeTabRef.current,
        );
        window.dispatchEvent(
          new CustomEvent(SLIDES_GENERATION_STARTED_EVENT, {
            detail: {
              generationAttemptId,
              outputId: generationOutputId,
              tabId: activeTabRef.current,
            },
          }),
        );
      }
    },
    [send, clearWatchdog],
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
      clearWatchdog();
      timeoutRef.current = setTimeout(
        () => setTimedOut(true),
        MAX_GENERATING_MS,
      );
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
