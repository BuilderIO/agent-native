import {
  isContinuationTerminalReason,
  isRequestedStopAbortReason,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useCallback, useEffect, useRef, useState } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

const GENERATION_ORPHAN_TIMEOUT_MS = 30 * 60_000;
const GENERATION_START_TIMEOUT_MS = 60_000;
// The server retries deferred continuations for up to five minutes.
const GENERATION_HANDOFF_TIMEOUT_MS = 5 * 60_000;
const GENERATION_STATUS_POLL_START_DELAY_MS = 3_000;
const GENERATION_STATUS_POLL_INTERVAL_MS = 5_000;
const GENERATION_STATUS_IDLE_CONFIRMATIONS = 2;
const STORED_RUN_IDLE_CONFIRMATIONS = 4;
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "errored",
  "aborted",
  "truncated",
]);

function isCorrelatedContinuationRun(args: {
  runId?: string;
  successorOfRunId?: string;
  turnId?: string;
  previousRunId: string | null;
  currentRunId: string | null;
  currentTurnId: string | null;
  sourceRunId: string | null;
  sourceTurnId: string | null;
  deferredRunId: string | null;
}): boolean {
  if (!args.runId || args.runId === args.previousRunId) return false;
  return (
    args.runId === args.currentRunId ||
    args.runId === args.sourceRunId ||
    args.runId === args.deferredRunId ||
    (args.successorOfRunId !== undefined &&
      (args.successorOfRunId === args.previousRunId ||
        args.successorOfRunId === args.currentRunId ||
        args.successorOfRunId === args.sourceRunId)) ||
    (args.turnId !== undefined &&
      (args.turnId === args.currentTurnId || args.turnId === args.sourceTurnId))
  );
}

interface UseAgentGeneratingOptions {
  onComplete?: (tabId: string | null) => void;
  onFailed?: (tabId: string | null) => void;
  onStopped?: (tabId: string | null) => void;
  onStale?: (tabId: string | null) => void;
  shouldAdoptRunningTab?: () => boolean;
  onAdoptRunningTab?: (tabId: string) => void;
  onRunConfirmed?: (
    tabId: string | null,
    runId: string | null,
    turnId?: string | null,
  ) => void;
  getPreviousRunBaseline?: (tabId: string) => PreviousRunBaseline | null;
}

interface TrackGenerationOptions {
  ignorePreviousRun?: boolean;
  previousRunId?: string;
  previousRunBaselineVerified?: boolean;
  currentRunId?: string;
  currentTurnId?: string;
  resumingStoredRun?: boolean;
}

interface PreviousRunBaseline {
  runId: string | null;
  verified: boolean;
  currentRunId?: string | null;
  currentTurnId?: string | null;
}

export function useAgentGenerating(options: UseAgentGeneratingOptions = {}) {
  const [generating, setGenerating] = useState(false);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const handoffTimeoutRef = useRef<number | null>(null);
  const statusPollTimeoutRef = useRef<number | null>(null);
  const statusPollGenerationRef = useRef(0);
  const generationIdlePollCountRef = useRef(0);
  const generationRunObservedRef = useRef(false);
  const resumingStoredRunRef = useRef(false);
  const storedRunIdlePollCountRef = useRef(0);
  const startFailedPendingRef = useRef(false);
  const waitingForContinuationRef = useRef(false);
  const requireActiveRunRef = useRef(false);
  const previousRunIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const continuationSourceRunIdRef = useRef<string | null>(null);
  const continuationSourceTurnIdRef = useRef<string | null>(null);
  const deferredRunIdRef = useRef<string | null>(null);
  const turnIdRecoveryAttemptedForRunRef = useRef<string | null>(null);
  const lastObservedRunRef = useRef<{ tabId: string; runId: string } | null>(
    null,
  );
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clearGenerationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearStatusPollTimeout = useCallback(() => {
    if (statusPollTimeoutRef.current) {
      window.clearTimeout(statusPollTimeoutRef.current);
      statusPollTimeoutRef.current = null;
    }
  }, []);

  const clearHandoffTimeout = useCallback(() => {
    if (handoffTimeoutRef.current) {
      window.clearTimeout(handoffTimeoutRef.current);
      handoffTimeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    statusPollGenerationRef.current += 1;
    clearGenerationTimeout();
    clearHandoffTimeout();
    clearStatusPollTimeout();
    activeTabIdRef.current = null;
    generationIdlePollCountRef.current = 0;
    generationRunObservedRef.current = false;
    resumingStoredRunRef.current = false;
    storedRunIdlePollCountRef.current = 0;
    startFailedPendingRef.current = false;
    waitingForContinuationRef.current = false;
    requireActiveRunRef.current = false;
    previousRunIdRef.current = null;
    currentRunIdRef.current = null;
    currentTurnIdRef.current = null;
    continuationSourceRunIdRef.current = null;
    continuationSourceTurnIdRef.current = null;
    deferredRunIdRef.current = null;
    turnIdRecoveryAttemptedForRunRef.current = null;
    setGenerating(false);
  }, [clearGenerationTimeout, clearHandoffTimeout, clearStatusPollTimeout]);

  const startGenerationTimeout = useCallback(
    (tabId: string | null) => {
      clearGenerationTimeout();
      if (resumingStoredRunRef.current) return;
      timeoutRef.current = window.setTimeout(
        () => {
          if (activeTabIdRef.current === tabId) {
            callbacksRef.current.onStale?.(tabId);
            reset();
          }
        },
        generationRunObservedRef.current
          ? GENERATION_ORPHAN_TIMEOUT_MS
          : GENERATION_START_TIMEOUT_MS,
      );
    },
    [clearGenerationTimeout, reset],
  );

  const startHandoffTimeout = useCallback(
    (tabId: string) => {
      if (handoffTimeoutRef.current !== null) return;
      handoffTimeoutRef.current = window.setTimeout(() => {
        handoffTimeoutRef.current = null;
        if (
          activeTabIdRef.current !== tabId ||
          !waitingForContinuationRef.current
        ) {
          return;
        }
        callbacksRef.current.onFailed?.(tabId);
        reset();
      }, GENERATION_HANDOFF_TIMEOUT_MS);
    },
    [reset],
  );

  const beginContinuationWait = useCallback(
    (tabId: string, sourceRunId?: string, sourceTurnId?: string) => {
      waitingForContinuationRef.current = true;
      generationIdlePollCountRef.current = 0;
      if (sourceRunId) continuationSourceRunIdRef.current = sourceRunId;
      if (sourceTurnId) {
        continuationSourceTurnIdRef.current = sourceTurnId;
      } else if (
        sourceRunId &&
        (sourceRunId === currentRunIdRef.current ||
          sourceRunId === previousRunIdRef.current ||
          sourceRunId === continuationSourceRunIdRef.current)
      ) {
        continuationSourceTurnIdRef.current = currentTurnIdRef.current;
      }
      clearGenerationTimeout();
      startHandoffTimeout(tabId);
    },
    [clearGenerationTimeout, startHandoffTimeout],
  );

  const confirmRun = useCallback(
    (
      tabId: string,
      runId?: string,
      active = false,
      successorOfRunId?: string,
      turnId?: string,
    ) => {
      const hasRunId = typeof runId === "string";
      const isKnownCurrentRun = hasRunId && runId === currentRunIdRef.current;
      const isDeferredRun = hasRunId && runId === deferredRunIdRef.current;
      const isDifferentTrackedRun =
        hasRunId &&
        currentRunIdRef.current !== null &&
        runId !== currentRunIdRef.current;
      const correlatedContinuationRun = isCorrelatedContinuationRun({
        runId,
        successorOfRunId,
        turnId,
        previousRunId: previousRunIdRef.current,
        currentRunId: currentRunIdRef.current,
        currentTurnId: currentTurnIdRef.current,
        sourceRunId: continuationSourceRunIdRef.current,
        sourceTurnId: continuationSourceTurnIdRef.current,
        deferredRunId: deferredRunIdRef.current,
      });
      const continuationCorrelationRequired =
        waitingForContinuationRef.current ||
        (currentRunIdRef.current !== null && currentTurnIdRef.current !== null);
      if (
        activeTabIdRef.current !== tabId ||
        (previousRunIdRef.current !== null &&
          (!runId || runId === previousRunIdRef.current)) ||
        (continuationCorrelationRequired &&
          isDifferentTrackedRun &&
          !correlatedContinuationRun) ||
        (waitingForContinuationRef.current &&
          hasRunId &&
          runId !== continuationSourceRunIdRef.current &&
          !correlatedContinuationRun) ||
        (requireActiveRunRef.current &&
          (!hasRunId ||
            (!active && !isKnownCurrentRun && !correlatedContinuationRun)))
      ) {
        return false;
      }
      const isFirstObservedRun = !generationRunObservedRef.current;
      const isNewRun = hasRunId && runId !== currentRunIdRef.current;
      generationRunObservedRef.current = true;
      resumingStoredRunRef.current = false;
      storedRunIdlePollCountRef.current = 0;
      requireActiveRunRef.current = false;
      if (hasRunId) {
        currentRunIdRef.current = runId!;
        lastObservedRunRef.current = { tabId, runId: runId! };
        if (isDeferredRun) deferredRunIdRef.current = null;
      }
      const discoveredTurnId =
        typeof turnId === "string" && turnId.length > 0 ? turnId : null;
      const isNewTurn =
        discoveredTurnId !== null &&
        discoveredTurnId !== currentTurnIdRef.current;
      if (discoveredTurnId) {
        currentTurnIdRef.current = discoveredTurnId;
        if (
          waitingForContinuationRef.current &&
          (runId === continuationSourceRunIdRef.current ||
            continuationSourceTurnIdRef.current === null)
        ) {
          continuationSourceTurnIdRef.current = discoveredTurnId;
        }
      }
      const advancesContinuation =
        waitingForContinuationRef.current &&
        hasRunId &&
        runId !== continuationSourceRunIdRef.current;
      if (advancesContinuation) {
        waitingForContinuationRef.current = false;
        continuationSourceRunIdRef.current = null;
        continuationSourceTurnIdRef.current = null;
        clearHandoffTimeout();
      }
      if (isFirstObservedRun || isNewRun || isNewTurn) {
        callbacksRef.current.onRunConfirmed?.(
          tabId,
          runId ?? null,
          discoveredTurnId ?? currentTurnIdRef.current ?? undefined,
        );
        startGenerationTimeout(tabId);
      }
      return true;
    },
    [clearHandoffTimeout, startGenerationTimeout],
  );

  const startStatusPolling = useCallback(
    (tabId: string, initialDelayMs = GENERATION_STATUS_POLL_START_DELAY_MS) => {
      clearStatusPollTimeout();
      const generation = ++statusPollGenerationRef.current;
      generationIdlePollCountRef.current = 0;
      const poll = async () => {
        if (
          statusPollGenerationRef.current !== generation ||
          activeTabIdRef.current !== tabId
        ) {
          return;
        }
        try {
          const response = await fetch(
            `${agentNativePath("/_agent-native/agent-chat")}/runs/active?threadId=${encodeURIComponent(tabId)}`,
            {
              credentials: "same-origin",
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) throw new Error("Could not read agent run state");
          const state = (await response.json()) as {
            active?: unknown;
            status?: unknown;
            runId?: unknown;
            turnId?: unknown;
            successorOfRunId?: unknown;
            terminalReason?: unknown;
            awaitingRedispatch?: unknown;
          };
          if (
            typeof state.active !== "boolean" ||
            typeof state.status !== "string" ||
            (state.runId != null && typeof state.runId !== "string") ||
            (state.turnId != null && typeof state.turnId !== "string") ||
            (state.successorOfRunId != null &&
              typeof state.successorOfRunId !== "string") ||
            (state.terminalReason != null &&
              typeof state.terminalReason !== "string") ||
            (state.awaitingRedispatch != null &&
              typeof state.awaitingRedispatch !== "boolean")
          ) {
            throw new Error("Agent run state was incomplete");
          }
          if (
            statusPollGenerationRef.current !== generation ||
            activeTabIdRef.current !== tabId
          ) {
            return;
          }
          const sourceRunId = currentRunIdRef.current;
          if (
            sourceRunId &&
            currentTurnIdRef.current === null &&
            state.runId !== sourceRunId &&
            typeof state.turnId === "string" &&
            state.successorOfRunId == null &&
            turnIdRecoveryAttemptedForRunRef.current !== sourceRunId
          ) {
            // Older pending records have a run ID but no persisted turn ID.
            turnIdRecoveryAttemptedForRunRef.current = sourceRunId;
            const params = new URLSearchParams({
              threadId: tabId,
              runId: sourceRunId,
            });
            try {
              const sourceResponse = await fetch(
                `${agentNativePath("/_agent-native/agent-chat")}/runs/latest?${params}`,
                {
                  credentials: "same-origin",
                  signal: AbortSignal.timeout(10_000),
                },
              );
              if (sourceResponse.ok) {
                const sourceState = (await sourceResponse.json()) as {
                  threadId?: unknown;
                  turnId?: unknown;
                };
                if (
                  sourceState.threadId === tabId &&
                  typeof sourceState.turnId === "string" &&
                  sourceState.turnId.length > 0
                ) {
                  currentTurnIdRef.current = sourceState.turnId;
                  callbacksRef.current.onRunConfirmed?.(
                    tabId,
                    sourceRunId,
                    sourceState.turnId,
                  );
                }
              } else if (sourceResponse.status !== 404) {
                turnIdRecoveryAttemptedForRunRef.current = null;
                throw new Error("Could not recover the tracked run turn");
              }
            } catch (error) {
              turnIdRecoveryAttemptedForRunRef.current = null;
              throw error;
            }
          }
          if (
            statusPollGenerationRef.current !== generation ||
            activeTabIdRef.current !== tabId
          ) {
            return;
          }
          const isAwaitingRedispatch = state.awaitingRedispatch === true;
          const isRunning = state.active && !isAwaitingRedispatch;
          const isIdle =
            !state.active && state.status === "idle" && !isAwaitingRedispatch;
          const isTerminal =
            !state.active &&
            TERMINAL_RUN_STATUSES.has(state.status) &&
            !isAwaitingRedispatch;
          if (!isRunning && !isIdle && !isTerminal && !isAwaitingRedispatch) {
            throw new Error("Agent run state was unrecognized");
          }
          if ((isRunning || isTerminal) && typeof state.runId !== "string") {
            throw new Error("Agent run state did not include a run ID");
          }
          if (resumingStoredRunRef.current && isIdle && state.runId == null) {
            storedRunIdlePollCountRef.current += 1;
            if (
              storedRunIdlePollCountRef.current >= STORED_RUN_IDLE_CONFIRMATIONS
            ) {
              callbacksRef.current.onStale?.(tabId);
              reset();
              return;
            }
          } else {
            storedRunIdlePollCountRef.current = 0;
          }
          const abortReason =
            state.status !== "aborted"
              ? null
              : typeof state.terminalReason === "string" &&
                  state.terminalReason.startsWith("aborted:")
                ? state.terminalReason.slice("aborted:".length)
                : typeof state.terminalReason === "string" &&
                    state.terminalReason.trim().length > 0
                  ? state.terminalReason
                  : null;
          const isContinuation =
            isAwaitingRedispatch ||
            state.status === "truncated" ||
            (state.status === "completed" &&
              isContinuationTerminalReason(state.terminalReason)) ||
            (abortReason !== null && isContinuationTerminalReason(abortReason));
          if (startFailedPendingRef.current) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            const successorOfRunId =
              typeof state.successorOfRunId === "string"
                ? state.successorOfRunId
                : undefined;
            const turnId =
              typeof state.turnId === "string" ? state.turnId : undefined;
            const correlatedDeferredRun = isCorrelatedContinuationRun({
              runId,
              successorOfRunId,
              turnId,
              previousRunId: previousRunIdRef.current,
              currentRunId: currentRunIdRef.current,
              currentTurnId: currentTurnIdRef.current,
              sourceRunId: continuationSourceRunIdRef.current,
              sourceTurnId: continuationSourceTurnIdRef.current,
              deferredRunId: deferredRunIdRef.current,
            });
            const hasDeferredTurn =
              isAwaitingRedispatch && correlatedDeferredRun;
            const existingRunConfirmed =
              !isAwaitingRedispatch &&
              (isRunning || isTerminal) &&
              confirmRun(tabId, runId, isRunning, successorOfRunId, turnId);
            if (!hasDeferredTurn && !existingRunConfirmed) {
              callbacksRef.current.onFailed?.(tabId);
              reset();
              return;
            }
            if (hasDeferredTurn && runId) {
              const isNewTurn =
                turnId !== undefined && turnId !== currentTurnIdRef.current;
              if (turnId) currentTurnIdRef.current = turnId;
              const sourceRunId =
                successorOfRunId ??
                currentRunIdRef.current ??
                previousRunIdRef.current ??
                undefined;
              if (!waitingForContinuationRef.current) {
                beginContinuationWait(tabId, sourceRunId, turnId);
              }
              if (runId !== currentRunIdRef.current || isNewTurn) {
                deferredRunIdRef.current = runId;
                currentRunIdRef.current = runId;
                generationRunObservedRef.current = true;
                callbacksRef.current.onRunConfirmed?.(
                  tabId,
                  runId,
                  turnId ?? currentTurnIdRef.current ?? undefined,
                );
              }
            }
            startFailedPendingRef.current = false;
          }
          if (isAwaitingRedispatch) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            const successorOfRunId =
              typeof state.successorOfRunId === "string"
                ? state.successorOfRunId
                : undefined;
            const turnId =
              typeof state.turnId === "string" ? state.turnId : undefined;
            const correlatedDeferredRun = isCorrelatedContinuationRun({
              runId,
              successorOfRunId,
              turnId,
              previousRunId: previousRunIdRef.current,
              currentRunId: currentRunIdRef.current,
              currentTurnId: currentTurnIdRef.current,
              sourceRunId: continuationSourceRunIdRef.current,
              sourceTurnId: continuationSourceTurnIdRef.current,
              deferredRunId: deferredRunIdRef.current,
            });
            if (correlatedDeferredRun && runId) {
              const isNewTurn =
                turnId !== undefined && turnId !== currentTurnIdRef.current;
              const sourceRunId =
                successorOfRunId ??
                currentRunIdRef.current ??
                previousRunIdRef.current ??
                undefined;
              if (!waitingForContinuationRef.current) {
                beginContinuationWait(tabId, sourceRunId, turnId);
              }
              if (turnId) currentTurnIdRef.current = turnId;
              if (runId !== currentRunIdRef.current || isNewTurn) {
                deferredRunIdRef.current = runId;
                currentRunIdRef.current = runId;
                generationRunObservedRef.current = true;
                callbacksRef.current.onRunConfirmed?.(
                  tabId,
                  runId,
                  turnId ?? currentTurnIdRef.current ?? undefined,
                );
              }
            }
            generationIdlePollCountRef.current = 0;
          } else if (isRunning) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            confirmRun(
              tabId,
              runId,
              true,
              typeof state.successorOfRunId === "string"
                ? state.successorOfRunId
                : undefined,
              typeof state.turnId === "string" ? state.turnId : undefined,
            );
            generationIdlePollCountRef.current = 0;
          } else if (isTerminal) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            const isCurrentRun = confirmRun(
              tabId,
              runId,
              false,
              typeof state.successorOfRunId === "string"
                ? state.successorOfRunId
                : undefined,
              typeof state.turnId === "string" ? state.turnId : undefined,
            );
            if (isContinuation) {
              if (isCurrentRun) {
                beginContinuationWait(
                  tabId,
                  runId,
                  typeof state.turnId === "string" ? state.turnId : undefined,
                );
              }
              generationIdlePollCountRef.current = 0;
            } else if (!isCurrentRun) {
              generationIdlePollCountRef.current = 0;
            } else if (state.status === "errored") {
              callbacksRef.current.onFailed?.(tabId);
              reset();
              return;
            } else if (state.status === "aborted") {
              if (
                abortReason === null ||
                abortReason === "protocol-cancel" ||
                isRequestedStopAbortReason(abortReason)
              ) {
                callbacksRef.current.onStopped?.(tabId);
              } else {
                callbacksRef.current.onFailed?.(tabId);
              }
              reset();
              return;
            } else {
              waitingForContinuationRef.current = false;
              continuationSourceRunIdRef.current = null;
              continuationSourceTurnIdRef.current = null;
              deferredRunIdRef.current = null;
              clearHandoffTimeout();
              generationIdlePollCountRef.current += 1;
            }
          } else if (
            generationRunObservedRef.current &&
            !waitingForContinuationRef.current
          ) {
            generationIdlePollCountRef.current += 1;
          } else {
            generationIdlePollCountRef.current = 0;
          }
          if (
            generationIdlePollCountRef.current >=
            GENERATION_STATUS_IDLE_CONFIRMATIONS
          ) {
            callbacksRef.current.onComplete?.(tabId);
            reset();
            return;
          }
        } catch {
          generationIdlePollCountRef.current = 0;
          storedRunIdlePollCountRef.current = 0;
        }
        if (
          statusPollGenerationRef.current === generation &&
          activeTabIdRef.current === tabId
        ) {
          statusPollTimeoutRef.current = window.setTimeout(
            poll,
            GENERATION_STATUS_POLL_INTERVAL_MS,
          );
        }
      };
      statusPollTimeoutRef.current = window.setTimeout(poll, initialDelayMs);
    },
    [
      beginContinuationWait,
      clearHandoffTimeout,
      clearStatusPollTimeout,
      confirmRun,
      reset,
    ],
  );

  const track = useCallback(
    (tabId: string, trackOptions: TrackGenerationOptions = {}) => {
      activeTabIdRef.current = tabId;
      setGenerating(true);
      generationIdlePollCountRef.current = 0;
      generationRunObservedRef.current = false;
      resumingStoredRunRef.current = trackOptions.resumingStoredRun === true;
      storedRunIdlePollCountRef.current = 0;
      waitingForContinuationRef.current = false;
      startFailedPendingRef.current = false;
      continuationSourceRunIdRef.current = null;
      clearHandoffTimeout();
      previousRunIdRef.current = trackOptions.ignorePreviousRun
        ? (trackOptions.previousRunId ??
          (lastObservedRunRef.current?.tabId === tabId
            ? lastObservedRunRef.current.runId
            : null))
        : null;
      currentRunIdRef.current = trackOptions.currentRunId ?? null;
      currentTurnIdRef.current = trackOptions.currentTurnId ?? null;
      continuationSourceTurnIdRef.current = null;
      deferredRunIdRef.current = null;
      turnIdRecoveryAttemptedForRunRef.current = null;
      requireActiveRunRef.current =
        trackOptions.ignorePreviousRun === true &&
        trackOptions.previousRunBaselineVerified !== true &&
        currentRunIdRef.current === null;
      startGenerationTimeout(tabId);
      startStatusPolling(tabId);
    },
    [clearHandoffTimeout, startGenerationTimeout, startStatusPolling],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isRunning === "boolean") {
        const eventTabId =
          typeof detail.tabId === "string" ? detail.tabId : null;
        if (!activeTabIdRef.current && detail.isRunning) {
          if (eventTabId && callbacksRef.current.shouldAdoptRunningTab?.()) {
            activeTabIdRef.current = eventTabId;
            generationIdlePollCountRef.current = 0;
            const baseline =
              callbacksRef.current.getPreviousRunBaseline?.(eventTabId);
            previousRunIdRef.current = baseline?.runId ?? null;
            currentRunIdRef.current = baseline?.currentRunId ?? null;
            currentTurnIdRef.current = baseline?.currentTurnId ?? null;
            resumingStoredRunRef.current = Boolean(baseline?.currentRunId);
            storedRunIdlePollCountRef.current = 0;
            requireActiveRunRef.current =
              baseline?.verified !== true && currentRunIdRef.current === null;
            callbacksRef.current.onAdoptRunningTab?.(eventTabId);
            setGenerating(true);
            startGenerationTimeout(eventTabId);
            if (typeof detail.runId === "string") {
              confirmRun(
                eventTabId,
                detail.runId,
                true,
                typeof detail.successorOfRunId === "string"
                  ? detail.successorOfRunId
                  : undefined,
                typeof detail.turnId === "string" ? detail.turnId : undefined,
              );
            }
            startStatusPolling(eventTabId);
            return;
          }
          return;
        }
        if (eventTabId && eventTabId !== activeTabIdRef.current) {
          if (!detail.isRunning && !activeTabIdRef.current) {
            return;
          }
          return;
        }

        if (!detail.isRunning) {
          const tabId = activeTabIdRef.current;
          if (!tabId) return;
          if (detail.reason === "start_failed") {
            startFailedPendingRef.current = true;
            startStatusPolling(tabId, 0);
            return;
          }
          if (detail.reason === "stopped") {
            if (
              previousRunIdRef.current !== null ||
              requireActiveRunRef.current
            ) {
              startStatusPolling(tabId);
              return;
            }
            callbacksRef.current.onStopped?.(tabId);
            reset();
            return;
          }
          if (
            detail.reason === "run.completed" ||
            detail.reason === "run.failed" ||
            detail.reason === "start_failed" ||
            detail.reason === "run.cancelled"
          ) {
            startStatusPolling(tabId);
            return;
          }
          startStatusPolling(tabId);
          return;
        }
        const tabId = activeTabIdRef.current;
        generationIdlePollCountRef.current = 0;
        setGenerating(true);
        if (tabId) {
          if (typeof detail.runId === "string") {
            confirmRun(
              tabId,
              detail.runId,
              true,
              typeof detail.successorOfRunId === "string"
                ? detail.successorOfRunId
                : undefined,
              typeof detail.turnId === "string" ? detail.turnId : undefined,
            );
          } else if (!generationRunObservedRef.current) {
            startGenerationTimeout(tabId);
          }
          startStatusPolling(tabId);
        }
      }
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, [confirmRun, reset, startGenerationTimeout, startStatusPolling]);

  useEffect(() => {
    return () => {
      statusPollGenerationRef.current += 1;
      clearGenerationTimeout();
      clearHandoffTimeout();
      clearStatusPollTimeout();
    };
  }, [clearGenerationTimeout, clearHandoffTimeout, clearStatusPollTimeout]);

  const submit = useCallback(
    (
      message: string,
      context: string,
      options?: Omit<AgentChatMessage, "message" | "context">,
    ) => {
      const tabId = sendToDesignAgentChat({
        ...options,
        message,
        context,
        submit: options?.submit ?? true,
        newTab: options?.newTab ?? true,
      });
      track(tabId);
      return tabId;
    },
    [track],
  );

  return { generating, submit, reset, track };
}
