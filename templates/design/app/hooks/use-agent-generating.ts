import {
  isContinuationTerminalReason,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { useCallback, useEffect, useRef, useState } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

const GENERATION_ORPHAN_TIMEOUT_MS = 30 * 60_000;
const GENERATION_START_TIMEOUT_MS = 60_000;
const GENERATION_STATUS_POLL_START_DELAY_MS = 3_000;
const GENERATION_STATUS_POLL_INTERVAL_MS = 5_000;
const GENERATION_STATUS_IDLE_CONFIRMATIONS = 2;
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "errored",
  "aborted",
  "truncated",
]);

interface UseAgentGeneratingOptions {
  onComplete?: (tabId: string | null) => void;
  onFailed?: (tabId: string | null) => void;
  onStopped?: (tabId: string | null) => void;
  onStale?: (tabId: string | null) => void;
  shouldAdoptRunningTab?: () => boolean;
  onAdoptRunningTab?: (tabId: string) => void;
  onRunConfirmed?: (tabId: string | null, runId: string | null) => void;
  getPreviousRunBaseline?: (tabId: string) => PreviousRunBaseline | null;
}

interface TrackGenerationOptions {
  ignorePreviousRun?: boolean;
  previousRunId?: string;
  previousRunBaselineVerified?: boolean;
}

interface PreviousRunBaseline {
  runId: string | null;
  verified: boolean;
}

export function useAgentGenerating(options: UseAgentGeneratingOptions = {}) {
  const [generating, setGenerating] = useState(false);
  const activeTabIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const statusPollTimeoutRef = useRef<number | null>(null);
  const statusPollGenerationRef = useRef(0);
  const generationIdlePollCountRef = useRef(0);
  const generationRunObservedRef = useRef(false);
  const waitingForContinuationRef = useRef(false);
  const requireActiveRunRef = useRef(false);
  const previousRunIdRef = useRef<string | null>(null);
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

  const reset = useCallback(() => {
    statusPollGenerationRef.current += 1;
    clearGenerationTimeout();
    clearStatusPollTimeout();
    activeTabIdRef.current = null;
    generationIdlePollCountRef.current = 0;
    generationRunObservedRef.current = false;
    waitingForContinuationRef.current = false;
    requireActiveRunRef.current = false;
    previousRunIdRef.current = null;
    setGenerating(false);
  }, [clearGenerationTimeout, clearStatusPollTimeout]);

  const startGenerationTimeout = useCallback(
    (tabId: string | null) => {
      clearGenerationTimeout();
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

  const confirmRun = useCallback(
    (tabId: string, runId?: string, active = false) => {
      if (
        activeTabIdRef.current !== tabId ||
        (previousRunIdRef.current !== null &&
          (!runId || runId === previousRunIdRef.current)) ||
        (requireActiveRunRef.current && (!active || !runId))
      ) {
        return false;
      }
      generationRunObservedRef.current = true;
      waitingForContinuationRef.current = false;
      requireActiveRunRef.current = false;
      if (runId) lastObservedRunRef.current = { tabId, runId };
      callbacksRef.current.onRunConfirmed?.(tabId, runId ?? null);
      startGenerationTimeout(tabId);
      return true;
    },
    [startGenerationTimeout],
  );

  const startStatusPolling = useCallback(
    (tabId: string) => {
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
            terminalReason?: unknown;
            awaitingRedispatch?: unknown;
          };
          if (
            typeof state.active !== "boolean" ||
            typeof state.status !== "string" ||
            (state.runId != null && typeof state.runId !== "string") ||
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
          const isRunning = state.active;
          const isIdle = !state.active && state.status === "idle";
          const isTerminal =
            !state.active && TERMINAL_RUN_STATUSES.has(state.status);
          if (!isRunning && !isIdle && !isTerminal) {
            throw new Error("Agent run state was unrecognized");
          }
          if ((isRunning || isTerminal) && typeof state.runId !== "string") {
            throw new Error("Agent run state did not include a run ID");
          }
          const abortReason =
            state.status === "aborted" &&
            typeof state.terminalReason === "string" &&
            state.terminalReason.startsWith("aborted:")
              ? state.terminalReason.slice("aborted:".length)
              : null;
          const isContinuation =
            state.awaitingRedispatch === true ||
            state.status === "truncated" ||
            (state.status === "completed" &&
              isContinuationTerminalReason(state.terminalReason)) ||
            (abortReason !== null && isContinuationTerminalReason(abortReason));
          if (isRunning) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            confirmRun(tabId, runId, true);
            generationIdlePollCountRef.current = 0;
          } else if (isTerminal) {
            const runId =
              typeof state.runId === "string" ? state.runId : undefined;
            const isCurrentRun = confirmRun(tabId, runId);
            if (!isCurrentRun) {
              if (isContinuation) waitingForContinuationRef.current = true;
              generationIdlePollCountRef.current = 0;
            } else if (state.status === "errored") {
              callbacksRef.current.onFailed?.(tabId);
              reset();
              return;
            } else if (isContinuation) {
              waitingForContinuationRef.current = true;
              generationIdlePollCountRef.current = 0;
            } else if (state.status === "aborted") {
              callbacksRef.current.onStopped?.(tabId);
              reset();
              return;
            } else {
              waitingForContinuationRef.current = false;
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
      statusPollTimeoutRef.current = window.setTimeout(
        poll,
        GENERATION_STATUS_POLL_START_DELAY_MS,
      );
    },
    [clearStatusPollTimeout, confirmRun, reset],
  );

  const track = useCallback(
    (tabId: string, trackOptions: TrackGenerationOptions = {}) => {
      activeTabIdRef.current = tabId;
      setGenerating(true);
      generationIdlePollCountRef.current = 0;
      generationRunObservedRef.current = false;
      waitingForContinuationRef.current = false;
      previousRunIdRef.current = trackOptions.ignorePreviousRun
        ? (trackOptions.previousRunId ??
          (lastObservedRunRef.current?.tabId === tabId
            ? lastObservedRunRef.current.runId
            : null))
        : null;
      requireActiveRunRef.current =
        trackOptions.ignorePreviousRun === true &&
        trackOptions.previousRunBaselineVerified !== true;
      startGenerationTimeout(tabId);
      startStatusPolling(tabId);
    },
    [startGenerationTimeout, startStatusPolling],
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
            requireActiveRunRef.current = baseline?.verified !== true;
            callbacksRef.current.onAdoptRunningTab?.(eventTabId);
            setGenerating(true);
            startGenerationTimeout(eventTabId);
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
          startGenerationTimeout(tabId);
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
      clearStatusPollTimeout();
    };
  }, [clearGenerationTimeout, clearStatusPollTimeout]);

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
