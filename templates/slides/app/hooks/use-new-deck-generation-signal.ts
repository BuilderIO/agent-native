import { useEffect, useRef, useState } from "react";

import {
  MAX_GENERATING_MS,
  useAgentGenerating,
} from "@/hooks/use-agent-generating";

const AUTO_CONTINUE_TIMEOUT_MS = 30_000;

export function useNewDeckGenerationSignal({
  attemptId,
  tabId,
  threadId,
  runId,
  actionOwned = Boolean(threadId || runId),
  broadGenerating,
  submitStarted,
}: {
  attemptId: string | null;
  tabId: string | null;
  threadId?: string | null;
  runId?: string | null;
  actionOwned?: boolean;
  broadGenerating: boolean;
  submitStarted: boolean;
}): {
  attempt: ReturnType<typeof useAgentGenerating>;
  generating: boolean;
  generationStarted: boolean;
} {
  const ownerId = threadId ?? tabId ?? runId;
  const attempt = useAgentGenerating({ tabId });
  const [observerTimedOutAttemptId, setObserverTimedOutAttemptId] = useState<
    string | null
  >(null);
  const [startedAttemptId, setStartedAttemptId] = useState<string | null>(null);
  const [autoContinueAttemptKey, setAutoContinueAttemptKey] = useState<
    string | null
  >(null);
  const [runFailedAttemptKey, setRunFailedAttemptKey] = useState<string | null>(
    null,
  );
  const [runStoppedAttemptKey, setRunStoppedAttemptKey] = useState<
    string | null
  >(null);
  const [threadRunActiveAttemptKey, setThreadRunActiveAttemptKey] = useState<
    string | null
  >(null);
  const [threadRunObservedAttemptKey, setThreadRunObservedAttemptKey] =
    useState<string | null>(null);
  const autoContinueTimeoutRef = useRef<number | null>(null);
  const observerTimedOut = observerTimedOutAttemptId === attemptId;
  const timedOut = attempt.timedOut || observerTimedOut;
  const currentAutoContinueAttemptKey =
    attemptId && ownerId ? `${attemptId}:${ownerId}` : null;
  const autoContinuing =
    currentAutoContinueAttemptKey !== null &&
    autoContinueAttemptKey === currentAutoContinueAttemptKey;
  const runFailed =
    currentAutoContinueAttemptKey !== null &&
    runFailedAttemptKey === currentAutoContinueAttemptKey;
  const runStopped =
    currentAutoContinueAttemptKey !== null &&
    runStoppedAttemptKey === currentAutoContinueAttemptKey;
  const threadRunActive =
    currentAutoContinueAttemptKey !== null &&
    threadRunActiveAttemptKey === currentAutoContinueAttemptKey;
  const threadRunObserved =
    currentAutoContinueAttemptKey !== null &&
    threadRunObservedAttemptKey === currentAutoContinueAttemptKey;
  const generating =
    !timedOut &&
    (autoContinuing ||
      (actionOwned
        ? threadRunActive || (tabId !== null && attempt.generating)
        : tabId
          ? attempt.generating
          : submitStarted && broadGenerating));

  useEffect(() => {
    if (!ownerId || !attemptId) return;
    const matchesOwner = (
      detail: Record<string, unknown> | null | undefined,
    ) => {
      if (!detail) return false;
      let matched = false;
      for (const [field, expected] of [
        ["tabId", tabId],
        ["threadId", threadId],
        ["runId", runId],
      ] as const) {
        if (!expected || typeof detail[field] !== "string") continue;
        if (detail[field] !== expected) return false;
        matched = true;
      }
      return matched;
    };
    const clearAutoContinue = () => {
      if (autoContinueTimeoutRef.current !== null) {
        clearTimeout(autoContinueTimeoutRef.current);
        autoContinueTimeoutRef.current = null;
      }
      setAutoContinueAttemptKey(null);
    };
    const handleAutoContinue = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!matchesOwner(detail)) return;
      if (autoContinueTimeoutRef.current !== null) {
        clearTimeout(autoContinueTimeoutRef.current);
      }
      setAutoContinueAttemptKey(`${attemptId}:${ownerId}`);
      autoContinueTimeoutRef.current = window.setTimeout(() => {
        autoContinueTimeoutRef.current = null;
        setAutoContinueAttemptKey(null);
      }, AUTO_CONTINUE_TIMEOUT_MS);
    };
    const handleRunning = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (actionOwned && matchesOwner(detail)) {
        const attemptKey = `${attemptId}:${ownerId}`;
        if (detail.isRunning === true) {
          setThreadRunActiveAttemptKey(attemptKey);
          setThreadRunObservedAttemptKey(attemptKey);
        } else if (detail.isRunning === false) {
          setThreadRunActiveAttemptKey((activeKey) =>
            activeKey === attemptKey ? null : activeKey,
          );
        }
      }
      if (
        matchesOwner(detail) &&
        detail.isRunning === false &&
        ["failed", "start_failed", "run.failed"].includes(detail.reason)
      ) {
        setRunFailedAttemptKey(`${attemptId}:${ownerId}`);
      }
      if (
        matchesOwner(detail) &&
        detail.isRunning === false &&
        ["stopped", "run.cancelled"].includes(detail.reason)
      ) {
        setRunStoppedAttemptKey(`${attemptId}:${ownerId}`);
      }
      if (
        matchesOwner(detail) &&
        (detail.isRunning === true ||
          [
            "stopped",
            "failed",
            "start_failed",
            "run.completed",
            "run.failed",
            "run.cancelled",
          ].includes(detail.reason))
      ) {
        clearAutoContinue();
      }
    };
    const handleRunError = (event: Event) => {
      if (matchesOwner((event as CustomEvent).detail)) {
        setRunFailedAttemptKey(`${attemptId}:${ownerId}`);
        clearAutoContinue();
      }
    };
    window.addEventListener("agent-chat:auto-continue", handleAutoContinue);
    window.addEventListener("agentNative.chatRunning", handleRunning);
    window.addEventListener("agent-chat:run-error", handleRunError);
    return () => {
      window.removeEventListener(
        "agent-chat:auto-continue",
        handleAutoContinue,
      );
      window.removeEventListener("agentNative.chatRunning", handleRunning);
      window.removeEventListener("agent-chat:run-error", handleRunError);
      if (autoContinueTimeoutRef.current !== null) {
        clearTimeout(autoContinueTimeoutRef.current);
        autoContinueTimeoutRef.current = null;
      }
    };
  }, [attemptId, ownerId, runId, tabId, threadId]);

  useEffect(() => {
    if (!attemptId || !submitStarted || ownerId) return;
    const timeout = window.setTimeout(
      () => setObserverTimedOutAttemptId(attemptId),
      MAX_GENERATING_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [attemptId, ownerId, submitStarted]);

  useEffect(() => {
    if (attemptId && (generating || attempt.observedRun)) {
      setStartedAttemptId(attemptId);
    }
  }, [attemptId, attempt.observedRun, generating]);

  return {
    attempt: {
      ...attempt,
      observedRun: actionOwned ? threadRunObserved : attempt.observedRun,
      runError: actionOwned ? runFailed : attempt.runError || runFailed,
      stopReason: actionOwned
        ? runStopped
          ? "stopped"
          : null
        : attempt.stopReason,
      timedOut,
    },
    generating,
    generationStarted: attemptId !== null && startedAttemptId === attemptId,
  };
}
