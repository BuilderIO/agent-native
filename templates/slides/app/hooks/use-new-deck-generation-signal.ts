import { useEffect, useState } from "react";

import {
  MAX_GENERATING_MS,
  useAgentGenerating,
} from "@/hooks/use-agent-generating";

export function useNewDeckGenerationSignal({
  attemptId,
  tabId,
  broadGenerating,
  submitStarted,
}: {
  attemptId: string | null;
  tabId: string | null;
  broadGenerating: boolean;
  submitStarted: boolean;
}): {
  attempt: ReturnType<typeof useAgentGenerating>;
  generating: boolean;
  generationStarted: boolean;
} {
  const attempt = useAgentGenerating({ tabId });
  const [observerTimedOutAttemptId, setObserverTimedOutAttemptId] = useState<
    string | null
  >(null);
  const [startedAttemptId, setStartedAttemptId] = useState<string | null>(null);
  const observerTimedOut = observerTimedOutAttemptId === attemptId;
  const timedOut = attempt.timedOut || observerTimedOut;
  const generating =
    !timedOut &&
    (tabId ? attempt.generating : submitStarted && broadGenerating);

  useEffect(() => {
    if (!attemptId || !submitStarted || tabId) return;
    const timeout = window.setTimeout(
      () => setObserverTimedOutAttemptId(attemptId),
      MAX_GENERATING_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [attemptId, submitStarted, tabId]);

  useEffect(() => {
    if (attemptId && (generating || attempt.observedRun)) {
      setStartedAttemptId(attemptId);
    }
  }, [attemptId, attempt.observedRun, generating]);

  return {
    attempt: { ...attempt, timedOut },
    generating,
    generationStarted: attemptId !== null && startedAttemptId === attemptId,
  };
}
