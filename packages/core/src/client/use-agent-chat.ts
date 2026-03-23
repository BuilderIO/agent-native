import { useState, useEffect, useCallback } from "react";
import { sendToAgentChat, type AgentChatMessage } from "./agent-chat.js";

/**
 * Hook that wraps sendToAgentChat with a loading state.
 *
 * Returns [isGenerating, send] where:
 * - isGenerating: true after send() is called, false when the
 *   builder.fusion.chatRunning event fires with detail.isRunning === false
 * - send: wrapper around sendToAgentChat that sets isGenerating to true
 */
export function useAgentChatGenerating(): [
  boolean,
  (opts: AgentChatMessage) => string,
] {
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.isRunning === false) {
        setIsGenerating(false);
      }
    };
    window.addEventListener("builder.fusion.chatRunning", handler);
    return () =>
      window.removeEventListener("builder.fusion.chatRunning", handler);
  }, []);

  const send = useCallback((opts: AgentChatMessage): string => {
    setIsGenerating(true);
    return sendToAgentChat(opts);
  }, []);

  return [isGenerating, send];
}
