import { useEffect, useState } from "react";

import {
  getStartedGenerationAttemptTabId,
  useAgentGenerating,
} from "@/hooks/use-agent-generating";

export function useNewDeckGenerationSignal({
  attemptId,
  outputId,
  tabId,
  progressToken,
}: {
  attemptId: string | null;
  outputId?: string | null;
  tabId: string | null;
  progressToken?: number;
}): {
  attempt: ReturnType<typeof useAgentGenerating>;
  generating: boolean;
  generationStarted: boolean;
} {
  const observedTabId =
    tabId ??
    (attemptId && outputId
      ? getStartedGenerationAttemptTabId(attemptId, outputId)
      : null);
  const attempt = useAgentGenerating({
    tabId: observedTabId,
    progressToken,
  });
  const [startedAttemptId, setStartedAttemptId] = useState<string | null>(null);
  const generating = attempt.generating;

  useEffect(() => {
    if (attemptId && (generating || attempt.observedRun)) {
      setStartedAttemptId(attemptId);
    }
  }, [attemptId, attempt.observedRun, generating]);

  return {
    attempt,
    generating,
    generationStarted: attemptId !== null && startedAttemptId === attemptId,
  };
}
