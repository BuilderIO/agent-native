import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client";

const GENERATION_TIMEOUT_MS = 120_000;

/**
 * Tracks whether an agent chat submission is in progress.
 * Design generation is scoped to the tab opened by this hook so unrelated or
 * stale chat runs do not leave the design UI stuck in a generating state.
 */
export function useAgentGenerating() {
  const [generating, setGenerating] = useState(false);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        const eventTabId =
          typeof detail.tabId === "string" ? detail.tabId : null;
        if (
          activeTabIdRef.current &&
          eventTabId &&
          eventTabId !== activeTabIdRef.current
        ) {
          return;
        }
        if (!detail.isRunning) {
          reset();
          return;
        }
        setGenerating(detail.isRunning);
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [reset]);

  useEffect(() => {
    return () => clearGenerationTimeout();
  }, [clearGenerationTimeout]);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Omit<AgentChatMessage, "message" | "context">,
    ) => {
      setGenerating(true);
      const tabId = sendToAgentChat({
        ...options,
        message,
        context,
        submit: options?.submit ?? true,
      });
      activeTabIdRef.current = tabId;
      clearGenerationTimeout();
      timeoutRef.current = window.setTimeout(() => {
        if (activeTabIdRef.current === tabId) {
          reset();
        }
      }, GENERATION_TIMEOUT_MS);
      return tabId;
    },
    [clearGenerationTimeout, reset],
  );

  return { generating, submit, reset };
}
