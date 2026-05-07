import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const PROMPT_RUN_STALE_MS = 120_000;

interface UseAgentPromptRunOptions {
  staleMessage: string;
}

export function useAgentPromptRun({
  staleMessage,
}: UseAgentPromptRunOptions) {
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const activePromptRef = useRef<string | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const staleMessageRef = useRef(staleMessage);
  staleMessageRef.current = staleMessage;

  const clearRunTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearRun = useCallback(() => {
    clearRunTimeout();
    activePromptRef.current = null;
    activeTabIdRef.current = null;
    setActivePrompt(null);
  }, [clearRunTimeout]);

  const startRunTimeout = useCallback(() => {
    clearRunTimeout();
    timeoutRef.current = window.setTimeout(() => {
      if (activePromptRef.current) {
        toast.info(staleMessageRef.current);
      }
      clearRun();
    }, PROMPT_RUN_STALE_MS);
  }, [clearRun, clearRunTimeout]);

  const trackRun = useCallback(
    (prompt: string, tabId: string | null) => {
      const trimmed = prompt.trim();
      if (!trimmed || !tabId) return;
      activePromptRef.current = trimmed;
      activeTabIdRef.current = tabId;
      setActivePrompt(trimmed);
      startRunTimeout();
    },
    [startRunTimeout],
  );

  const isActivePrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      return !!trimmed && activePrompt === trimmed;
    },
    [activePrompt],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      if (!activeTabIdRef.current) return;
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning !== "boolean") return;

      const eventTabId =
        typeof detail.tabId === "string" ? detail.tabId : null;
      if (eventTabId && eventTabId !== activeTabIdRef.current) return;

      if (detail.isRunning) {
        startRunTimeout();
        return;
      }
      clearRun();
    };

    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [clearRun, startRunTimeout]);

  useEffect(() => {
    return () => clearRunTimeout();
  }, [clearRunTimeout]);

  return { activePrompt, clearRun, isActivePrompt, trackRun };
}
