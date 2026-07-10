import { useEffect, useState, useCallback } from "react";

import { agentNativePath } from "./api-path.js";

/**
 * Per-thread chat run health, derived from the durable `last_progress_at`
 * timestamp on the server. Drives the user-visible "this chat looks stuck"
 * affordance — distinct from the silent reconnect logic in
 * `agent-chat-adapter.ts`, which keeps trying in the background. When
 * automatic recovery isn't making progress (for whatever reason), this
 * hook surfaces a Retry / Cancel button to the user instead of leaving
 * them staring at a frozen spinner.
 */
export interface RunStuckState {
  /** True when an active run hasn't emitted an event for `stuckThresholdMs`. */
  isStuck: boolean;
  /** ID of the active run, or null when nothing is in flight. */
  runId: string | null;
  /** Server-side run status ("running" / "completed" / "errored" / etc.). */
  status: string | null;
  /** Server timestamp (ms) of the last emitted event, or null if none yet. */
  lastProgressAt: number | null;
  /** Milliseconds since `lastProgressAt`, or null. */
  stuckSinceMs: number | null;
  /** Server timestamp (ms) of the last process-alive heartbeat. */
  heartbeatAt: number | null;
  /** Milliseconds since `heartbeatAt`, computed against the server clock. */
  heartbeatSinceMs: number | null;
  /** How the run was dispatched/continued, e.g. foreground-self-chain or background-processing. */
  dispatchMode: string | null;
  /**
   * Server-authoritative: true when the run holds an open tool call or A2A
   * `agent_call` delegation (`in_flight_since` marker set). Preferred over the
   * client-side proxy for deciding whether Retry (which aborts the run) is
   * safe to offer. Null when the server bundle predates this field.
   */
  hasInFlightWork: boolean | null;
}

export interface UseRunStuckDetectionOptions {
  /** The thread to monitor. Pass null/undefined to disable polling. */
  threadId: string | null | undefined;
  /**
   * Set false to skip scheduling the poll loop entirely — used to gate
   * polling to only the active chat tab when multiple tabs are mounted
   * (inactive tabs are kept alive via display:none, not unmounted).
   * Defaults to true.
   */
  enabled?: boolean;
  /**
   * Threshold above which an in-flight FOREGROUND run is considered stuck.
   * The default sits comfortably above the adapter's 75s no-progress
   * reconnect — by then automatic recovery has already had its chance.
   */
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
  /**
   * Threshold for a claimed durable background worker that is still sending
   * fresh process heartbeats. These workers can legitimately spend up to the
   * 12-minute tool/no-progress window on large Design, Plan, or Assets work.
   * Default 13 minutes, matching the durable chunk handoff boundary.
   */
  liveBackgroundStuckThresholdMs?: number;
  /** Poll interval. Default 5_000ms. */
  pollIntervalMs?: number;
  /** API base path. Default `/_agent-native/agent-chat`. */
  apiUrl?: string;
}

const DEFAULT_STUCK_THRESHOLD_MS = 90_000;
export const DEFAULT_BACKGROUND_STUCK_THRESHOLD_MS = 180_000;
export const DEFAULT_LIVE_BACKGROUND_STUCK_THRESHOLD_MS = 13 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const IDLE_BACKOFF_INTERVAL_MS = 15_000;
const FRESH_BACKGROUND_HEARTBEAT_MS = 30_000;

interface ActiveRunResponse {
  active: boolean;
  runId?: string;
  status?: string;
  heartbeatAt: number | null;
  lastProgressAt?: number | null;
  dispatchMode?: string | null;
  /** Server clock at response time, used to compute elapsed server-relative. */
  serverNow?: number;
  /** True when the run holds an open tool/A2A call (in_flight_since marker). */
  hasInFlightWork?: boolean;
}

const EMPTY_STATE: RunStuckState = {
  isStuck: false,
  runId: null,
  status: null,
  lastProgressAt: null,
  stuckSinceMs: null,
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
    // Reset on every thread change so the previous thread's stuck banner
    // doesn't bleed onto the new one before the first poll completes.
    setState(EMPTY_STATE);
    if (!threadId || !enabled) return;

    const base = apiUrl ?? agentNativePath("/_agent-native/agent-chat");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      let nextDelay = pollIntervalMs;
      try {
        const res = await fetch(
          `${base}/runs/active?threadId=${encodeURIComponent(threadId)}`,
          { credentials: "same-origin" },
        );
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as ActiveRunResponse;
          const lastProgressAt = data.lastProgressAt ?? null;
          // Measure elapsed against the SERVER clock (serverNow) rather than the
          // client's Date.now(). lastProgressAt is a server timestamp, so client
          // clock skew of more than stuckThresholdMs would otherwise mark every
          // run stuck (clock ahead) or never stuck (clock behind). Fall back to
          // the client clock for older bundles that don't send serverNow.
          const nowMs = data.serverNow ?? Date.now();
          const stuckSinceMs =
            lastProgressAt != null ? nowMs - lastProgressAt : null;
          const heartbeatAt = data.heartbeatAt ?? null;
          const heartbeatSinceMs =
            heartbeatAt != null ? nowMs - heartbeatAt : null;
          const dispatchMode =
            typeof data.dispatchMode === "string" ? data.dispatchMode : null;
          // Server-continued runs get the wider threshold: the server's own
          // recovery (150s no-progress backstop + chained continuations) must
          // get its chance before the user sees a "stuck" affordance.
          const serverContinued =
            dispatchMode === "foreground-self-chain" ||
            dispatchMode?.startsWith("background") === true;
          // A claimed durable worker with a fresh heartbeat can legitimately
          // be waiting on a bounded long-running tool/sub-agent call. Showing
          // Retry at the generic 3-minute continuation threshold aborts healthy
          // work and starts the same call again. Let the worker's own 12-minute
          // watchdog act first; a dead/stale heartbeat still gets the earlier
          // background fallback below.
          const liveBackgroundWorker =
            dispatchMode === "background-processing" &&
            heartbeatSinceMs != null &&
            heartbeatSinceMs >= 0 &&
            heartbeatSinceMs < FRESH_BACKGROUND_HEARTBEAT_MS;
          const effectiveThresholdMs = liveBackgroundWorker
            ? liveBackgroundStuckThresholdMs
            : serverContinued
              ? backgroundStuckThresholdMs
              : stuckThresholdMs;
          const isStuck = Boolean(
            data.active &&
            data.status === "running" &&
            stuckSinceMs != null &&
            stuckSinceMs > effectiveThresholdMs,
          );
          setState({
            isStuck,
            runId: data.runId ?? null,
            status: data.status ?? null,
            lastProgressAt,
            stuckSinceMs,
            heartbeatAt,
            heartbeatSinceMs,
            dispatchMode,
            hasInFlightWork:
              typeof data.hasInFlightWork === "boolean"
                ? data.hasInFlightWork
                : null,
          });
          // Back off polling when nothing is in flight — there's no point
          // hammering the endpoint while the chat is idle. We still poll
          // occasionally so a fresh run started in another tab is picked up.
          if (!data.active || data.status !== "running") {
            nextDelay = IDLE_BACKOFF_INTERVAL_MS;
          }
        }
      } catch {
        // Network blip — leave previous state. Next tick will retry.
      }
      if (!cancelled) {
        timer = setTimeout(poll, nextDelay);
      }
    };

    // Stagger the first poll so a freshly-started run isn't immediately
    // classified as stuck before the server has had a chance to record
    // any progress events.
    timer = setTimeout(poll, 2_000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

/**
 * POST `/runs/:id/abort` so the server flips the run to "aborted" and the
 * adapter's reconnect loop exits cleanly. Returns the run id that was
 * aborted (or null on failure) so callers can correlate observability
 * events. Best-effort — failures are swallowed, since the user's intent
 * is already captured locally.
 */
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
