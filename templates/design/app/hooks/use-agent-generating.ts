import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client";

const GENERATION_TIMEOUT_MS = 120_000;

interface UseAgentGeneratingOptions {
  onComplete?: (tabId: string | null) => void;
  onStale?: (tabId: string | null) => void;
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
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clearGenerationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearGenerationTimeout();
    activeTabIdRef.current = null;
    setGenerating(false);
  }, [clearGenerationTimeout]);

  const startGenerationTimeout = useCallback(
    (tabId: string | null) => {
      clearGenerationTimeout();
      timeoutRef.current = window.setTimeout(() => {
        if (activeTabIdRef.current === tabId) {
          callbacksRef.current.onStale?.(tabId);
          reset();
        }
      }, GENERATION_TIMEOUT_MS);
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

        if (!activeTabIdRef.current && detail.isRunning) return;
        if (eventTabId && eventTabId !== activeTabIdRef.current) return;

        if (!detail.isRunning) {
          callbacksRef.current.onComplete?.(activeTabIdRef.current);
          reset();
          return;
        }
        setGenerating(true);
        startGenerationTimeout(activeTabIdRef.current);
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [reset, startGenerationTimeout]);

  useEffect(() => {
    return () => clearGenerationTimeout();
  }, [clearGenerationTimeout]);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Omit<AgentChatMessage, "message" | "context">,
    ) => {
      const tabId = sendToAgentChat({
        ...options,
        message,
        context,
        submit: options?.submit ?? true,
      });
      track(tabId);
      return tabId;
    },
    [track],
  );

  return { generating, submit, reset, track };
}
