import { type AgentChatMessage } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useCallback, useEffect, useRef, useState } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

const GENERATION_ORPHAN_TIMEOUT_MS = 30 * 60_000;
const GENERATION_STATUS_POLL_START_DELAY_MS = 3_000;
const GENERATION_STATUS_POLL_INTERVAL_MS = 5_000;
const GENERATION_STATUS_IDLE_CONFIRMATIONS = 2;
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "errored",
  "aborted",
  "truncated",
]);
const CHAT_STOP_DEBOUNCE_MS = 4_000;

interface UseAgentGeneratingOptions {
  onComplete?: (tabId: string | null) => void;
  onStopped?: (tabId: string | null) => void;
  onStale?: (tabId: string | null) => void;
  shouldAdoptRunningTab?: () => boolean;
  onAdoptRunningTab?: (tabId: string) => void;
  onRunning?: (tabId: string | null) => void;
}

export function useAgentGenerating(options: UseAgentGeneratingOptions = {}) {
  const [generating, setGenerating] = useState(false);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const statusPollTimeoutRef = useRef<number | null>(null);
  const statusPollGenerationRef = useRef(0);
  const generationIdlePollCountRef = useRef(0);
  const stopDebounceRef = useRef<number | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clearStopDebounce = useCallback(() => {
    if (stopDebounceRef.current) {
      window.clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }
  }, []);

  const clearGenerationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearStatusPollTimeout = useCallback(() => {
    if (statusPollTimeoutRef.current) {
      window.clearTimeout(statusPollTimeoutRef.current);
      statusPollTimeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    statusPollGenerationRef.current += 1;
    clearGenerationTimeout();
    clearStatusPollTimeout();
    clearStopDebounce();
    activeTabIdRef.current = null;
    generationIdlePollCountRef.current = 0;
    setGenerating(false);
  }, [clearGenerationTimeout, clearStatusPollTimeout, clearStopDebounce]);

  const startGenerationTimeout = useCallback(
    (tabId: string | null) => {
      clearGenerationTimeout();
      timeoutRef.current = window.setTimeout(() => {
        if (activeTabIdRef.current === tabId) {
          callbacksRef.current.onStale?.(tabId);
          reset();
        }
      }, GENERATION_ORPHAN_TIMEOUT_MS);
    },
    [clearGenerationTimeout, reset],
  );

  const startStatusPolling = useCallback(
    (tabId: string) => {
      clearStatusPollTimeout();
      const generation = ++statusPollGenerationRef.current;
      generationIdlePollCountRef.current = 0;
      const poll = async () => {
        if (
          statusPollGenerationRef.current !== generation ||
          activeTabIdRef.current !== tabId
        ) {
          return;
        }
        try {
          const response = await fetch(
            `${agentNativePath("/_agent-native/agent-chat")}/runs/active?threadId=${encodeURIComponent(tabId)}`,
            {
              credentials: "same-origin",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) throw new Error("Could not read agent run state");
          const state = (await response.json()) as {
            active?: unknown;
            status?: unknown;
          };
          if (
            typeof state.active !== "boolean" ||
            typeof state.status !== "string"
          ) {
            throw new Error("Agent run state was incomplete");
          }
          if (
            statusPollGenerationRef.current !== generation ||
            activeTabIdRef.current !== tabId
          ) {
            return;
          }
          const isRunning = state.active && state.status === "running";
          const isIdle = !state.active && state.status === "idle";
          const isTerminal = TERMINAL_RUN_STATUSES.has(state.status);
          if (!isRunning && !isIdle && !isTerminal) {
            throw new Error("Agent run state was unrecognized");
          }
          if (isRunning) {
            generationIdlePollCountRef.current = 0;
          } else {
            generationIdlePollCountRef.current += 1;
          }
          if (
            generationIdlePollCountRef.current >=
            GENERATION_STATUS_IDLE_CONFIRMATIONS
          ) {
            callbacksRef.current.onComplete?.(tabId);
            reset();
            return;
          }
        } catch {
          generationIdlePollCountRef.current = 0;
        }
        if (
          statusPollGenerationRef.current === generation &&
          activeTabIdRef.current === tabId
        ) {
          statusPollTimeoutRef.current = window.setTimeout(
            poll,
            GENERATION_STATUS_POLL_INTERVAL_MS,
          );
        }
      };
      statusPollTimeoutRef.current = window.setTimeout(
        poll,
        GENERATION_STATUS_POLL_START_DELAY_MS,
      );
    },
    [clearStatusPollTimeout, reset],
  );

  const track = useCallback(
    (tabId: string) => {
      activeTabIdRef.current = tabId;
      setGenerating(true);
      startGenerationTimeout(tabId);
      startStatusPolling(tabId);
    },
    [startGenerationTimeout, startStatusPolling],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        const eventTabId =
          typeof detail.tabId === "string" ? detail.tabId : null;

        if (!activeTabIdRef.current && detail.isRunning) {
          if (eventTabId && callbacksRef.current.shouldAdoptRunningTab?.()) {
            activeTabIdRef.current = eventTabId;
            callbacksRef.current.onAdoptRunningTab?.(eventTabId);
            callbacksRef.current.onRunning?.(eventTabId);
            setGenerating(true);
            startGenerationTimeout(eventTabId);
            startStatusPolling(eventTabId);
            return;
          }
          return;
        }
        if (eventTabId && eventTabId !== activeTabIdRef.current) {
          if (!detail.isRunning && !activeTabIdRef.current) {
            return;
          }
          return;
        }

        if (!detail.isRunning) {
          clearStopDebounce();
          const tabId = activeTabIdRef.current;
          if (!tabId) return;
          if (detail.reason === "stopped") {
            callbacksRef.current.onStopped?.(tabId);
            reset();
            return;
          }
          stopDebounceRef.current = window.setTimeout(() => {
            stopDebounceRef.current = null;
            if (activeTabIdRef.current !== tabId) return;
            callbacksRef.current.onComplete?.(tabId);
            reset();
          }, CHAT_STOP_DEBOUNCE_MS);
          return;
        }
        clearStopDebounce();
        const tabId = activeTabIdRef.current;
        callbacksRef.current.onRunning?.(tabId);
        setGenerating(true);
        if (tabId) {
          startGenerationTimeout(tabId);
          startStatusPolling(tabId);
        }
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [clearStopDebounce, reset, startGenerationTimeout, startStatusPolling]);

  useEffect(() => {
    return () => {
      statusPollGenerationRef.current += 1;
      clearGenerationTimeout();
      clearStatusPollTimeout();
      clearStopDebounce();
    };
  }, [clearGenerationTimeout, clearStatusPollTimeout, clearStopDebounce]);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Omit<AgentChatMessage, "message" | "context">,
    ) => {
      const tabId = sendToDesignAgentChat({
        ...options,
        message,
        context,
        submit: options?.submit ?? true,
        newTab: options?.newTab ?? true,
      });
      track(tabId);
      return tabId;
    },
    [track],
  );

  return { generating, submit, reset, track };
}
