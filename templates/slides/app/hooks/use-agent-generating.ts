import {
  useAgentChatGenerating,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback } from "react";

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook.
 */
export function useAgentGenerating() {
  const [generating, send] = useAgentChatGenerating();

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Pick<AgentChatMessage, "newTab" | "openSidebar">,
    ) => {
      send({ message, context, submit: true, ...options });
    },
    [send],
  );

  return { generating, submit };
}
