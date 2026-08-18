import {
  useAgentChatGenerating,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { useCallback, useEffect, useRef, useState } from "react";

// This is only a lost-signal recovery guard. A long deck legitimately takes
// several minutes because each slide is written and fit-checked separately.
const MAX_GENERATING_MS = 30 * 60 * 1000;

// Gateway continuations can briefly report a stopped chat between model/tool
// chunks. Keep generation UI and presence steady across that transport gap.
export const CHAT_STOP_DEBOUNCE_MS = 4_000;

type AgentGeneratingSubmitOptions = Pick<
  AgentChatMessage,
  "newTab" | "openSidebar"
> & {
  reuseEmptyTab?: boolean;
};

/**
 * Tracks whether an agent chat submission is in progress.
 * Wraps @agent-native/core's useAgentChatGenerating hook, with a timeout
 * fallback so a run that never reports completion can't spin forever.
 */
export function useAgentGenerating() {
  const [generating, send] = useAgentChatGenerating();
  const [recentlyGenerating, setRecentlyGenerating] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearStopDebounce = useCallback(() => {
    if (stopDebounceRef.current !== null) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (generating) {
      clearStopDebounce();
      setRecentlyGenerating(true);
    } else if (recentlyGenerating) {
      clearStopDebounce();
      stopDebounceRef.current = setTimeout(() => {
        stopDebounceRef.current = null;
        setRecentlyGenerating(false);
      }, CHAT_STOP_DEBOUNCE_MS);
    }

    if (!generating && !recentlyGenerating) {
      clearWatchdog();
      setTimedOut(false);
    }

    return clearStopDebounce;
  }, [generating, recentlyGenerating, clearStopDebounce, clearWatchdog]);

  useEffect(
    () => () => {
      clearWatchdog();
      clearStopDebounce();
    },
    [clearStopDebounce, clearWatchdog],
  );

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: AgentGeneratingSubmitOptions,
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

  return {
    generating: (generating || recentlyGenerating) && !timedOut,
    submit,
  };
}
