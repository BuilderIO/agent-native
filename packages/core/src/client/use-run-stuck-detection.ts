import { useEffect, useState, useCallback } from "react";

import { createPollEngine } from "../shared/poll-engine.js";
import {
  ACTIVE_RUN_STATE_EVENT,
  getActiveRun,
  type ActiveRunState,
} from "./active-run-state.js";
import { agentNativePath } from "./api-path.js";

export interface RunStuckState {
  isStuck: boolean;
  runId: string | null;
  status: string | null;
  lastProgressAt: number | null;
  stuckSinceMs: number | null;
  lastProgressSeq: number | null;
  heartbeatAt: number | null;
  heartbeatSinceMs: number | null;
  dispatchMode: string | null;
  hasInFlightWork: boolean | null;
}

export interface UseRunStuckDetectionOptions {
  threadId: string | null | undefined;
  enabled?: boolean;
  stuckThresholdMs?: number;
  /**
   * Threshold for BACKGROUND-dispatched runs (dispatchMode starts with
   * "background"). The server owns recovery for these — its run-manager
   * no-progress backstop (150s) and unclaimed-run sweep act first — so the
   * user-facing "stuck" affordance is a late fallback, not a race against
   * them. Selected inside the hook because the dispatch mode is only known
   * from the same poll response that computes the elapsed time.
   */
  backgroundStuckThresholdMs?: number;
  liveBackgroundStuckThresholdMs?: number;
  pollIntervalMs?: number;
  apiUrl?: string;
}

const DEFAULT_STUCK_THRESHOLD_MS = 90_000;
export const DEFAULT_BACKGROUND_STUCK_THRESHOLD_MS = 180_000;
export const DEFAULT_LIVE_BACKGROUND_STUCK_THRESHOLD_MS = 13 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const IDLE_BACKOFF_INTERVAL_MS = 15_000;
const MAX_POLL_ERROR_BACKOFF_MS = 30_000;
const FRESH_BACKGROUND_HEARTBEAT_MS = 30_000;
const POLL_ABORT_MIN_MS = 10_000;
function getPollAbortMs(interval: number): number {
  return Math.max(POLL_ABORT_MIN_MS, interval * 4);
}

interface ActiveRunResponse {
  active: boolean;
  runId?: string;
  status?: string;
  heartbeatAt: number | null;
  lastProgressAt?: number | null;
  dispatchMode?: string | null;
  serverNow?: number;
  hasInFlightWork?: boolean;
}

const EMPTY_STATE: RunStuckState = {
  isStuck: false,
  runId: null,
  status: null,
  lastProgressAt: null,
  stuckSinceMs: null,
  lastProgressSeq: null,
  heartbeatAt: null,
  heartbeatSinceMs: null,
  dispatchMode: null,
  hasInFlightWork: null,
};

export function useRunStuckDetection({
  threadId,
  enabled = true,
  stuckThresholdMs = DEFAULT_STUCK_THRESHOLD_MS,
  backgroundStuckThresholdMs = DEFAULT_BACKGROUND_STUCK_THRESHOLD_MS,
  liveBackgroundStuckThresholdMs = DEFAULT_LIVE_BACKGROUND_STUCK_THRESHOLD_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  apiUrl,
}: UseRunStuckDetectionOptions): RunStuckState {
  const [state, setState] = useState<RunStuckState>(EMPTY_STATE);

  useEffect(() => {
    setState(EMPTY_STATE);
    if (!threadId || !enabled) return;

    const base = apiUrl ?? agentNativePath("/_agent-native/agent-chat");
    let cancelled = false;
    let snapshotTransitionTimer: ReturnType<typeof setTimeout> | null = null;
    let snapshotVersion = 0;
    let lastObservedLocalProgressAt: number | null = null;
    let lastObservedLocalProgressSeq: number | null = null;
    let consecutivePollFailures = 0;
    const nextDelayRef = { current: 2_000 };

    const pollFailureDelay = () => {
      consecutivePollFailures += 1;
      return Math.min(
        Math.max(pollIntervalMs, 1) * 2 ** consecutivePollFailures,
        MAX_POLL_ERROR_BACKOFF_MS,
      );
    };

    const clearObservedRun = () => {
      snapshotVersion += 1;
      if (snapshotTransitionTimer) clearTimeout(snapshotTransitionTimer);
      snapshotTransitionTimer = null;
      setState(EMPTY_STATE);
    };

    type RunHealthSnapshot = {
      active: boolean;
      runId: string | null;
      status: string | null;
      lastProgressAt: number | null;
      stuckSinceMs: number | null;
      localProgressObservedAt: number | null;
      lastProgressSeq: number | null;
      heartbeatAt: number | null;
      heartbeatSinceMs: number | null;
      dispatchMode: string | null;
    };

    const effectiveThresholdFor = (
      dispatchMode: string | null,
      heartbeatSinceMs: number | null,
    ) => {
      const liveBackgroundWorker =
        dispatchMode === "background-processing" &&
        heartbeatSinceMs != null &&
        heartbeatSinceMs >= 0 &&
        heartbeatSinceMs < FRESH_BACKGROUND_HEARTBEAT_MS;
      const serverContinued =
        dispatchMode === "foreground-self-chain" ||
        dispatchMode?.startsWith("background") === true;
      return liveBackgroundWorker
        ? Math.min(backgroundStuckThresholdMs, liveBackgroundStuckThresholdMs)
        : serverContinued
          ? backgroundStuckThresholdMs
          : stuckThresholdMs;
    };

    const scheduleSnapshotTransition = (
      snapshot: RunHealthSnapshot,
      observedAtMs: number,
      version: number,
    ) => {
      if (snapshotTransitionTimer) clearTimeout(snapshotTransitionTimer);
      snapshotTransitionTimer = null;
      if (
        cancelled ||
        version !== snapshotVersion ||
        !snapshot.active ||
        snapshot.status !== "running" ||
        snapshot.runId == null
      ) {
        return;
      }

      const currentElapsedMs = Math.max(0, Date.now() - observedAtMs);
      const currentHeartbeatSinceMs =
        snapshot.heartbeatSinceMs == null
          ? null
          : snapshot.heartbeatSinceMs + currentElapsedMs;
      const currentStuckSinceMs =
        snapshot.stuckSinceMs == null
          ? null
          : snapshot.stuckSinceMs + currentElapsedMs;
      const currentLocalProgressSinceMs =
        snapshot.localProgressObservedAt == null
          ? null
          : Math.max(0, Date.now() - snapshot.localProgressObservedAt);
      const effectiveThresholdMs = effectiveThresholdFor(
        snapshot.dispatchMode,
        currentHeartbeatSinceMs,
      );
      const localProgressFresh = Boolean(
        currentLocalProgressSinceMs != null &&
        currentLocalProgressSinceMs <= effectiveThresholdMs,
      );
      const currentlyStuck = Boolean(
        !localProgressFresh &&
        currentStuckSinceMs != null &&
        currentStuckSinceMs > effectiveThresholdMs,
      );
      const transitionDelaysMs: number[] = [];
      if (
        currentHeartbeatSinceMs != null &&
        currentHeartbeatSinceMs >= 0 &&
        currentHeartbeatSinceMs < FRESH_BACKGROUND_HEARTBEAT_MS
      ) {
        transitionDelaysMs.push(
          FRESH_BACKGROUND_HEARTBEAT_MS - currentHeartbeatSinceMs + 1,
        );
      }
      if (
        !localProgressFresh &&
        currentStuckSinceMs != null &&
        !currentlyStuck
      ) {
        transitionDelaysMs.push(
          Math.max(1, effectiveThresholdMs - currentStuckSinceMs + 1),
        );
      }
      if (localProgressFresh && currentLocalProgressSinceMs != null) {
        transitionDelaysMs.push(
          Math.max(1, effectiveThresholdMs - currentLocalProgressSinceMs + 1),
        );
      }
      if (transitionDelaysMs.length === 0) return;

      const delayMs = Math.max(1, Math.min(...transitionDelaysMs));
      snapshotTransitionTimer = setTimeout(() => {
        snapshotTransitionTimer = null;
        if (cancelled || version !== snapshotVersion) return;
        const elapsedSinceObservationMs = Math.max(
          0,
          Date.now() - observedAtMs,
        );
        const nextHeartbeatSinceMs =
          snapshot.heartbeatSinceMs == null
            ? null
            : snapshot.heartbeatSinceMs + elapsedSinceObservationMs;
        const nextStuckSinceMs =
          snapshot.stuckSinceMs == null
            ? null
            : snapshot.stuckSinceMs + elapsedSinceObservationMs;
        const nextLocalProgressSinceMs =
          snapshot.localProgressObservedAt == null
            ? null
            : Math.max(0, Date.now() - snapshot.localProgressObservedAt);
        const nextEffectiveThresholdMs = effectiveThresholdFor(
          snapshot.dispatchMode,
          nextHeartbeatSinceMs,
        );
        const nextLocalProgressFresh = Boolean(
          nextLocalProgressSinceMs != null &&
          nextLocalProgressSinceMs <= nextEffectiveThresholdMs,
        );
        const nextIsStuck = Boolean(
          !nextLocalProgressFresh &&
          nextStuckSinceMs != null &&
          nextStuckSinceMs > nextEffectiveThresholdMs,
        );
        setState((current) => {
          if (
            version !== snapshotVersion ||
            current.runId !== snapshot.runId ||
            current.lastProgressAt !== snapshot.lastProgressAt ||
            current.heartbeatAt !== snapshot.heartbeatAt ||
            current.lastProgressSeq !== snapshot.lastProgressSeq
          ) {
            return current;
          }
          return {
            ...current,
            isStuck: nextIsStuck,
            stuckSinceMs: nextLocalProgressFresh ? null : nextStuckSinceMs,
            heartbeatSinceMs: nextHeartbeatSinceMs,
          };
        });
        scheduleSnapshotTransition(snapshot, observedAtMs, version);
      }, delayMs);
    };

    const onActiveRunStateChange = (event: Event) => {
      const activeRun = ((
        event as CustomEvent<{ state?: ActiveRunState | null }>
      ).detail?.state ?? getActiveRun()) as ActiveRunState | null;
      const progressSeq = activeRun?.lastProgressSeq ?? null;
      const hasNewerProgress =
        typeof activeRun?.lastProgressObservedAt === "number" &&
        (activeRun.lastProgressObservedAt >
          (lastObservedLocalProgressAt ?? -1) ||
          (activeRun.lastProgressObservedAt === lastObservedLocalProgressAt &&
            progressSeq != null &&
            progressSeq > (lastObservedLocalProgressSeq ?? -1)));
      if (
        !activeRun ||
        activeRun.threadId !== threadId ||
        typeof activeRun.lastProgressObservedAt !== "number" ||
        !hasNewerProgress
      ) {
        return;
      }
      lastObservedLocalProgressAt = activeRun.lastProgressObservedAt;
      lastObservedLocalProgressSeq = progressSeq;
      snapshotVersion += 1;
      if (snapshotTransitionTimer) clearTimeout(snapshotTransitionTimer);
      snapshotTransitionTimer = null;
      setState((current) => {
        if (current.runId !== activeRun.runId || !current.isStuck) {
          return current;
        }
        return { ...current, isStuck: false, stuckSinceMs: null };
      });
    };
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, onActiveRunStateChange);

    const attempt = async (signal: AbortSignal) => {
      let nextDelay = pollIntervalMs;
      try {
        const res = await fetch(
          `${base}/runs/active?threadId=${encodeURIComponent(threadId)}`,
          { credentials: "same-origin", signal },
        );
        if (cancelled) return;
        if (res.ok) {
          consecutivePollFailures = 0;
          const data = (await res.json()) as ActiveRunResponse;
          const lastProgressAt = data.lastProgressAt ?? null;
          const nowMs = data.serverNow ?? Date.now();
          const stuckSinceMs =
            lastProgressAt != null ? nowMs - lastProgressAt : null;
          const heartbeatAt = data.heartbeatAt ?? null;
          const heartbeatSinceMs =
            heartbeatAt != null ? nowMs - heartbeatAt : null;
          const dispatchMode =
            typeof data.dispatchMode === "string" ? data.dispatchMode : null;
          const runId = data.runId ?? null;
          const activeRun = getActiveRun();
          const localProgressObservedAt =
            activeRun?.threadId === threadId && activeRun.runId === runId
              ? (activeRun.lastProgressObservedAt ?? null)
              : null;
          const localProgressSinceMs =
            localProgressObservedAt == null
              ? null
              : Math.max(0, Date.now() - localProgressObservedAt);
          const effectiveThresholdMs = effectiveThresholdFor(
            dispatchMode,
            heartbeatSinceMs,
          );
          const isStuck = Boolean(
            data.active &&
            data.status === "running" &&
            stuckSinceMs != null &&
            stuckSinceMs > effectiveThresholdMs &&
            (localProgressSinceMs == null ||
              localProgressSinceMs > effectiveThresholdMs),
          );
          const observedAtMs = Date.now();
          const version = ++snapshotVersion;
          scheduleSnapshotTransition(
            {
              active: data.active,
              runId,
              status: data.status ?? null,
              lastProgressAt,
              stuckSinceMs,
              localProgressObservedAt,
              lastProgressSeq:
                activeRun?.threadId === threadId && activeRun.runId === runId
                  ? (activeRun.lastProgressSeq ?? null)
                  : null,
              heartbeatAt,
              heartbeatSinceMs,
              dispatchMode,
            },
            observedAtMs,
            version,
          );
          setState({
            isStuck,
            runId,
            status: data.status ?? null,
            lastProgressAt,
            stuckSinceMs:
              localProgressSinceMs != null &&
              localProgressSinceMs <= effectiveThresholdMs
                ? null
                : stuckSinceMs,
            lastProgressSeq:
              activeRun?.threadId === threadId && activeRun.runId === runId
                ? (activeRun.lastProgressSeq ?? null)
                : null,
            heartbeatAt,
            heartbeatSinceMs,
            dispatchMode,
            hasInFlightWork:
              typeof data.hasInFlightWork === "boolean"
                ? data.hasInFlightWork
                : null,
          });
          if (!data.active || data.status !== "running") {
            nextDelay = IDLE_BACKOFF_INTERVAL_MS;
          }
        } else if (res.status === 429 || res.status >= 500) {
          nextDelay = pollFailureDelay();
        } else {
          consecutivePollFailures = 0;
          clearObservedRun();
          nextDelay = MAX_POLL_ERROR_BACKOFF_MS;
        }
      } catch {
        nextDelay = pollFailureDelay();
      } finally {
        nextDelayRef.current = nextDelay;
      }
    };

    const engine = createPollEngine(attempt, {
      intervalMs: () => nextDelayRef.current,
      timeoutMs: getPollAbortMs(pollIntervalMs),
      leading: false,
    });
    engine.start();

    const onVisibilityChange = () => {
      if (document.hidden) {
        engine.stop();
      } else {
        engine.start();
        engine.pollNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      snapshotVersion += 1;
      engine.stop();
      if (snapshotTransitionTimer) clearTimeout(snapshotTransitionTimer);
      window.removeEventListener(
        ACTIVE_RUN_STATE_EVENT,
        onActiveRunStateChange,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    threadId,
    enabled,
    stuckThresholdMs,
    backgroundStuckThresholdMs,
    liveBackgroundStuckThresholdMs,
    pollIntervalMs,
    apiUrl,
  ]);

  return state;
}

export function useAbortRun(apiUrl?: string) {
  return useCallback(
    async (runId: string, reason: string = "user"): Promise<string | null> => {
      const base = apiUrl ?? agentNativePath("/_agent-native/agent-chat");
      try {
        const res = await fetch(
          `${base}/runs/${encodeURIComponent(runId)}/abort`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ reason }),
          },
        );
        if (!res.ok) return null;
        return runId;
      } catch {
        return null;
      }
    },
    [apiUrl],
  );
}
