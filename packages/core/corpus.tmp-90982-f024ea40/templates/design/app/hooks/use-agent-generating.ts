import type { AgentChatMessage } from "@agent-native/core/client";
import { useCallback, useEffect, useRef, useState } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

// This is only a lost-signal recovery guard. Large design prompts can
// legitimately take several minutes, so avoid treating normal latency as
// failure.
const GENERATION_ORPHAN_TIMEOUT_MS = 30 * 60_000;
// Auto-continue briefly sets isRunning=false between gateway continuations.
// Debounce stop handling so we do not flash "generation complete" mid-turn.
const CHAT_STOP_DEBOUNCE_MS = 4_000;

interface UseAgentGeneratingOptions {
  onComplete?: (tabId: string | null) => void;
  onStale?: (tabId: string | null) => void;
  /** When chat starts on a tab we did not open, adopt it if this returns true. */
  shouldAdoptRunningTab?: () => boolean;
  onAdoptRunningTab?: (tabId: string) => void;
  onRunning?: (tabId: string | null) => void;
}

/**
 * Tracks whether an agent chat submission is in progress.
 * Design generation is scoped to the tab opened by this hook so unrelated or
 * stale chat runs do not leave the design UI stuck in a generating state.
 */
export function useAgentGenerating(options: UseAgentGeneratingOptions = {}) {
  const [generating, setGenerating] = useState(false);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
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

  const reset = useCallback(() => {
    clearGenerationTimeout();
    clearStopDebounce();
    activeTabIdRef.current = null;
    setGenerating(false);
  }, [clearGenerationTimeout, clearStopDebounce]);

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

  const track = useCallback(
    (tabId: string) => {
      activeTabIdRef.current = tabId;
      setGenerating(true);
      startGenerationTimeout(tabId);
    },
    [startGenerationTimeout],
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
          stopDebounceRef.current = window.setTimeout(() => {
            stopDebounceRef.current = null;
            if (activeTabIdRef.current !== tabId) return;
            callbacksRef.current.onComplete?.(tabId);
            reset();
          }, CHAT_STOP_DEBOUNCE_MS);
          return;
        }
        clearStopDebounce();
        callbacksRef.current.onRunning?.(activeTabIdRef.current);
        setGenerating(true);
        startGenerationTimeout(activeTabIdRef.current);
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [clearStopDebounce, reset, startGenerationTimeout]);

  useEffect(() => {
    return () => {
      clearGenerationTimeout();
      clearStopDebounce();
    };
  }, [clearGenerationTimeout, clearStopDebounce]);

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
