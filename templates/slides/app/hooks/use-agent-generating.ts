import {
  useAgentChatGenerating,
  useAgentEngineConfigured,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// This is only a lost-signal recovery guard. A long deck legitimately takes
// several minutes because each slide is written and fit-checked separately.
const MAX_GENERATING_MS = 30 * 60 * 1000;

// Gateway continuations can briefly report a stopped chat between model/tool
// chunks. Keep generation UI and presence steady across that transport gap.
export const CHAT_STOP_DEBOUNCE_MS = 4_000;
const CHAT_SUBMIT_TARGET_EVENT = "agentNative.chatSubmitTarget";

type AgentGeneratingSubmitOptions = Pick<
  AgentChatMessage,
  | "newTab"
  | "openSidebar"
  | "referenceImagePaths"
  | "images"
  | "model"
  | "engine"
  | "effort"
> & {
  reuseEmptyTab?: boolean;
  attachments?: ReadonlyArray<unknown>;
};

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook, with a timeout
 * fallback so a run that never reports completion can't spin forever.
 */
export function useAgentGenerating() {
  const [generating, send, stopReason] = useAgentChatGenerating();
  const engineConfigured = useAgentEngineConfigured();
  const [recentlyGenerating, setRecentlyGenerating] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [runError, setRunError] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSubmitRef = useRef<string | null>(null);
  const activeTabRef = useRef<string | null>(null);
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
      const submitMessageId = `slides-submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        ...options,
      } as AgentChatMessage & { attachments?: ReadonlyArray<unknown> });
    },
    [send, clearWatchdog],
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
    timedOut,
    submit,
  };
}
