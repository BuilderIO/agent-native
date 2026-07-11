import { useState, useEffect, useCallback, useRef } from "react";

import { sendToAgentChat, type AgentChatMessage } from "./agent-chat.js";

/**
 * Hook that wraps sendToAgentChat with a loading state.
 *
 * Returns [isGenerating, send] where:
 * - isGenerating: true after send() is called, false when the
 *   agentNative.chatRunning event reports that the run has stopped
 * - send: wrapper around sendToAgentChat that sets isGenerating to true
 */
export function useAgentChatGenerating(): [
  boolean,
  (opts: AgentChatMessage) => string,
] {
  const [isGenerating, setIsGenerating] = useState(false);
  const activeTabRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning !== "boolean") return;
      // Only honor events for the run this hook started. Events carrying a
      // different tabId belong to another chat surface (sidebar, other
      // composer, automation) and must not flip our state. Legacy events
      // without a tabId are honored for backwards compatibility.
      const eventTabId = typeof detail.tabId === "string" ? detail.tabId : null;
      if (
        eventTabId &&
        activeTabRef.current &&
        eventTabId !== activeTabRef.current
      ) {
        return;
      }
      if (!detail.isRunning && eventTabId === activeTabRef.current) {
        activeTabRef.current = null;
      }
      setIsGenerating(detail.isRunning);
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, []);

  const send = useCallback((opts: AgentChatMessage): string => {
    const tabId = sendToAgentChat(opts);
    activeTabRef.current = tabId;
    setIsGenerating(true);
    return tabId;
  }, []);

  return [isGenerating, send];
}
