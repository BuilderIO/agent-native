import { useCallback } from "react";
import { useAgentChatGenerating as useCoreGenerating, sendToAgentChat } from "@agent-native/core/client";

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook.
 */
export function useAgentChatGenerating() {
  const [generating, send] = useCoreGenerating();

  const submit = useCallback((message: string, context: string) => {
    send({ message, context, submit: true });
  }, [send]);

  return { generating, submit };
}
