import { useAgentChatGenerating } from "@agent-native/core/client";
import { useCallback } from "react";

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook.
 */
export function useAgentGenerating() {
  const [generating, send] = useAgentChatGenerating();

  const submit = useCallback(
    (message: string, context: string) => {
      send({ message, context, submit: true });
    },
    [send],
  );

  return { generating, submit };
}
