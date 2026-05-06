import { useCallback, useEffect, useState } from "react";
import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client";

/**
 * Tracks whether an agent chat submission is in progress.
 * Design generation can start on one route and complete on another, so this
 * follows the global chat-running bridge instead of only local submissions.
 */
export function useAgentGenerating() {
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        setGenerating(detail.isRunning);
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, []);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Omit<AgentChatMessage, "message" | "context">,
    ) => {
      setGenerating(true);
      return sendToAgentChat({
        ...options,
        message,
        context,
        submit: options?.submit ?? true,
      });
    },
    [],
  );

  return { generating, submit };
}
