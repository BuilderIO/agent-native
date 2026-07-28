import {
  useAgentChatGenerating,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useState } from "react";

// Ceiling for one agent turn triggered from these panels (e.g. 3 sequential
// image-generation attempts with retries). If the `agentNative.chatRunning`
// stop event never arrives for this run — the run errors out before the
// framework can broadcast it stopped — callers would otherwise spin forever.
const MAX_GENERATING_MS = 3 * 60 * 1000;

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook, with a timeout
 * fallback so a run that never reports completion can't spin forever.
 */
export function useAgentGenerating() {
  const [generating, send] = useAgentChatGenerating();
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!generating) {
      clearWatchdog();
      setTimedOut(false);
    }
    return clearWatchdog;
  }, [generating, clearWatchdog]);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Pick<AgentChatMessage, "newTab" | "openSidebar">,
    ) => {
      setTimedOut(false);
      clearWatchdog();
      timeoutRef.current = setTimeout(
        () => setTimedOut(true),
        MAX_GENERATING_MS,
      );
      send({ message, context, submit: true, ...options });
    },
    [send, clearWatchdog],
  );

  return { generating: generating && !timedOut, submit };
}
