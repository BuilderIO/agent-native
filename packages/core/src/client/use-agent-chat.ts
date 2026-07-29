import { useState, useEffect, useCallback, useRef } from "react";

import {
  AGENT_CHAT_SUBMIT_TARGET_EVENT,
  generateAgentChatSubmitMessageId,
  sendToAgentChat,
  type AgentChatMessage,
  type AgentChatSubmitTarget,
} from "./agent-chat.js";

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
  const activeSubmitRef = useRef<string | null>(null);

  useEffect(() => {
    const targetHandler = (e: Event) => {
      const detail = (e as CustomEvent<AgentChatSubmitTarget>).detail;
      if (
        !detail ||
        detail.submitMessageId !== activeSubmitRef.current ||
        !detail.tabId
      ) {
        return;
      }
      activeTabRef.current = detail.tabId;
    };
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
        activeSubmitRef.current = null;
      }
      setIsGenerating(detail.isRunning);
    };
    window.addEventListener(
      AGENT_CHAT_SUBMIT_TARGET_EVENT,
      targetHandler as EventListener,
    );
    window.addEventListener("agentNative.chatRunning", handler);
    return () => {
      window.removeEventListener(
        AGENT_CHAT_SUBMIT_TARGET_EVENT,
        targetHandler as EventListener,
      );
      window.removeEventListener("agentNative.chatRunning", handler);
    };
  }, []);

  const send = useCallback((opts: AgentChatMessage): string => {
    const submitMessageId =
      opts.submitMessageId ?? generateAgentChatSubmitMessageId();
    activeSubmitRef.current = submitMessageId;
    const tabId = sendToAgentChat({ ...opts, submitMessageId });
    activeTabRef.current = tabId;
    setIsGenerating(true);
    return tabId;
  }, []);

  return [isGenerating, send];
}
