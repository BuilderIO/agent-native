import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { trackEvent } from "./analytics.js";
import {
  useRunStuckDetection,
  useAbortRun,
  type RunStuckState,
} from "./use-run-stuck-detection.js";
import { cn } from "./utils.js";

/**
 * Surface a user-visible affordance when a chat run hasn't emitted any
 * events for an unusually long time. The adapter's silent reconnect logic
 * keeps trying in the background; this banner is the fallback when those
 * attempts haven't restored progress and the user is staring at a frozen
 * spinner.
 */
export interface RunStuckBannerProps {
  /** The thread to monitor. Pass null/undefined to disable. */
  threadId: string | null | undefined;
  /**
   * Set false to skip polling entirely — used when this banner is mounted
   * for a background tab kept alive via display:none. Only the active tab
   * should poll `/runs/active`. Defaults to true.
   */
  enabled?: boolean;
  /** API base path. Default `/_agent-native/agent-chat`. */
  apiUrl?: string;
  /**
   * Threshold above which an in-flight run is considered stuck.
   * Defaults to 90s (after the adapter's 75s no-progress reconnect
   * has had a chance to recover).
   */
  stuckThresholdMs?: number;
  /**
   * Called when the user clicks Retry. Implementations should re-prompt
   * the agent (typically via `chatHandle.sendMessage(...)`) — the banner
   * itself only handles aborting the prior run.
   */
  onRetry?: (runId: string) => void;
  /**
   * Returns true when the run has a tool call or sub-agent (A2A) call that
   * hasn't returned a result yet — typically backed by
   * `chatHandle.hasInFlightWork()`. "No progress" for a stretch of time does
   * not mean the run is dead: a long provider query or a cross-app `call
   * agent` can legitimately emit nothing for minutes. When this returns
   * true, Retry (which aborts the run) is hidden — aborting would destroy
   * real in-flight work and re-execute the same long call from scratch.
   * Only Cancel, an explicit destructive choice, remains available. Checked
   * fresh on every render; omit to keep the unconditional Retry/Cancel
   * behavior.
   */
  hasInFlightWork?: () => boolean;
  /**
   * Called whenever the stuck state transitions. Useful for surfacing
   * observability events (Sentry, PostHog) at the call site.
   */
  onStuckStateChange?: (state: RunStuckState) => void;
  /**
   * Automatically abort and retry once when the server reports a run is
   * alive but has stopped making real progress. Manual controls remain visible
   * as the fallback if the automatic recovery cannot clear the run.
   */
  autoRetry?: boolean;
  /**
   * Stable browser-tab/window id used to coordinate automatic retries across
   * multiple mounted chat views for the same thread. A local id is generated
   * when omitted.
   */
  autoRetryOwnerId?: string;
  /** Extra class on the outer container. */
  className?: string;
}

const AUTO_RETRY_CLAIM_TTL_MS = 5 * 60 * 1000;
const BACKGROUND_WORKER_FRESH_HEARTBEAT_MS = 30_000;

type BusyState = { type: "none" } | { type: "cancel" | "retry"; runId: string };

type MaybeLockManager = {
  request<T>(
    name: string,
    options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean },
    callback: (lock: unknown) => T | Promise<T>,
  ): Promise<T>;
};

function createAutoRetryOwnerId() {
  const cryptoApi =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto
      : null;
  return cryptoApi?.randomUUID() ?? `owner-${Math.random().toString(36)}`;
}

function autoRetryClaimKey(threadId: string, runId: string) {
  return `agent-native:stuck-auto-retry:${threadId}:${runId}`;
}

function isFreshBackgroundWorker(state: RunStuckState): boolean {
  return Boolean(
    state.status === "running" &&
    state.dispatchMode === "background-processing" &&
    state.heartbeatSinceMs != null &&
    state.heartbeatSinceMs >= 0 &&
    state.heartbeatSinceMs < BACKGROUND_WORKER_FRESH_HEARTBEAT_MS,
  );
}

function markAutoRetryClaim(key: string, ownerId: string) {
  if (typeof window === "undefined") return true;
  const now = Date.now();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const existing = JSON.parse(raw) as {
        ownerId?: unknown;
        expiresAt?: unknown;
      };
      const expiresAt =
        typeof existing.expiresAt === "number" ? existing.expiresAt : 0;
      if (expiresAt > now && existing.ownerId !== ownerId) return false;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({ ownerId, expiresAt: now + AUTO_RETRY_CLAIM_TTL_MS }),
    );
    const confirmed = JSON.parse(window.localStorage.getItem(key) ?? "{}") as {
      ownerId?: unknown;
    };
    return confirmed.ownerId === ownerId;
  } catch {
    // Private browsing or disabled storage: fall back to in-tab retry. The
    // server abort is idempotent, and manual controls remain available.
    return true;
  }
}

async function claimAutoRetryAttempt(
  threadId: string | null | undefined,
  runId: string,
  ownerId: string,
) {
  if (!threadId) return true;
  const key = autoRetryClaimKey(threadId, runId);
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: MaybeLockManager }).locks
      : undefined;
  if (locks?.request) {
    try {
      return await locks.request(
        key,
        { mode: "exclusive", ifAvailable: true },
        (lock) => (lock ? markAutoRetryClaim(key, ownerId) : false),
      );
    } catch {
      return markAutoRetryClaim(key, ownerId);
    }
  }
  return markAutoRetryClaim(key, ownerId);
}

export function RunStuckBanner({
  threadId,
  enabled = true,
  apiUrl,
  stuckThresholdMs,
  onRetry,
  onStuckStateChange,
  autoRetry = false,
  autoRetryOwnerId,
  hasInFlightWork,
  className,
}: RunStuckBannerProps) {
  const state = useRunStuckDetection({
    threadId,
    enabled,
    stuckThresholdMs,
    apiUrl,
  });
  const abortRun = useAbortRun(apiUrl);
  const [busy, setBusy] = useState<BusyState>({ type: "none" });
  const autoRetriedRunIdsRef = useRef<Set<string>>(new Set());
  const generatedOwnerIdRef = useRef<string | null>(null);
  if (!generatedOwnerIdRef.current) {
    generatedOwnerIdRef.current = createAutoRetryOwnerId();
  }
  const ownerId = autoRetryOwnerId ?? generatedOwnerIdRef.current;
  const backgroundWorkerStillAlive = isFreshBackgroundWorker(state);
  // A live tool call or sub-agent (A2A) call means "no progress" is not the
  // same as "dead" — the process is genuinely still doing the user's work.
  // Retry aborts the run, so it must not be offered as the (implicitly
  // safe-looking) primary action while real work is in flight; see the
  // `hasInFlightWork` prop doc comment. Re-checked on every render (the
  // underlying source mutates in place as tool/agent-call events stream in),
  // which is why this is a function prop rather than a plain boolean.
  //
  // Two sources, combined disjunctively (either knowing = in flight): the
  // SERVER-authoritative `state.hasInFlightWork` from /runs/active (the
  // `in_flight_since` marker, correct even when the client's message list is
  // stale after a reconnect/reader-mode replay) and the client-side proxy
  // prop (unresolved tool-call parts in the local messages). Destroying live
  // work is the failure we guard against, so we err toward "in flight" if
  // either signal says so.
  const inFlightWork =
    state.hasInFlightWork === true || (hasInFlightWork?.() ?? false);
  // Server-continued runs are recovered by the SERVER (chained continuation
  // chunks + lost-handoff sweep); an automatic client abort would kill a live
  // server-chained run. Auto-retry is therefore disabled unconditionally for
  // these modes — not just a fresh-heartbeat worker — and the
  // localStorage/Web-Locks auto-retry claim below is never taken for them (the
  // adapter's follow loop is read-only, so multiple tabs need no retry dedup).
  // Only the manual banner remains, on the wider server-owned threshold from
  // useRunStuckDetection.
  const isServerContinuedDispatch =
    state.dispatchMode === "foreground-self-chain" ||
    state.dispatchMode?.startsWith("background") === true;

  const lastReportedRef = useRef<{
    isStuck: boolean;
    runId: string | null;
  }>({ isStuck: false, runId: null });
  useEffect(() => {
    const last = lastReportedRef.current;
    if (last.isStuck === state.isStuck && last.runId === state.runId) return;
    lastReportedRef.current = { isStuck: state.isStuck, runId: state.runId };
    onStuckStateChange?.(state);
    if (state.isStuck && state.runId) {
      trackEvent("agent_chat_stuck_detected", {
        runId: state.runId,
        threadId: threadId ?? null,
        stuckSinceMs: state.stuckSinceMs ?? null,
        stuckSinceSec:
          state.stuckSinceMs != null
            ? Math.floor(state.stuckSinceMs / 1000)
            : null,
        runStatus: state.status,
      });
    }
  }, [state, onStuckStateChange, threadId]);

  // Reset the busy spinner once the underlying run is no longer the one we
  // acted on. A recovery continuation can start quickly enough that polling
  // never observes an idle state between run ids.
  useEffect(() => {
    setBusy((current) => {
      if (current.type === "none") return current;
      if (state.status !== "running") return { type: "none" };
      if (state.runId && state.runId !== current.runId) return { type: "none" };
      return current;
    });
  }, [state.runId, state.status]);

  useEffect(() => {
    if (
      !autoRetry ||
      // Server owns recovery for these dispatch modes — never auto-abort (see
      // comment on isServerContinuedDispatch above).
      isServerContinuedDispatch ||
      backgroundWorkerStillAlive ||
      // A live tool/A2A call in flight — never auto-abort real work (see
      // `inFlightWork` comment above).
      inFlightWork ||
      !state.isStuck ||
      !state.runId ||
      busy.type !== "none" ||
      autoRetriedRunIdsRef.current.has(state.runId)
    ) {
      return;
    }

    const runId = state.runId;
    void claimAutoRetryAttempt(threadId, runId, ownerId).then((claimed) => {
      autoRetriedRunIdsRef.current.add(runId);
      if (!claimed) return;
      setBusy({ type: "retry", runId });
      trackEvent("agent_chat_stuck_auto_retry", {
        runId,
        threadId: threadId ?? null,
        stuckSinceMs: state.stuckSinceMs ?? null,
      });
      void abortRun(runId, "auto_stuck_retry").then((aborted) => {
        if (aborted) {
          onRetry?.(aborted);
          return;
        }
        setBusy((current) =>
          current.type !== "none" && current.runId === runId
            ? { type: "none" }
            : current,
        );
      });
    });
  }, [
    abortRun,
    autoRetry,
    backgroundWorkerStillAlive,
    busy,
    inFlightWork,
    isServerContinuedDispatch,
    onRetry,
    ownerId,
    state.isStuck,
    state.runId,
    state.stuckSinceMs,
    threadId,
  ]);

  if (!state.isStuck || !state.runId) return null;

  const handleCancel = async () => {
    if (!state.runId || busy.type !== "none") return;
    const runId = state.runId;
    setBusy({ type: "cancel", runId });
    trackEvent("agent_chat_stuck_cancel", {
      runId,
      threadId: threadId ?? null,
      stuckSinceMs: state.stuckSinceMs ?? null,
    });
    await abortRun(runId, "user_stuck_cancel");
  };

  const handleRetry = async () => {
    // Defense in depth: the button is hidden while `inFlightWork` is true
    // (see render below), but guard the handler itself too so an abort can
    // never be triggered against live work through this path.
    if (!state.runId || busy.type !== "none" || inFlightWork) return;
    const runId = state.runId;
    setBusy({ type: "retry", runId });
    trackEvent("agent_chat_stuck_retry", {
      runId,
      threadId: threadId ?? null,
      stuckSinceMs: state.stuckSinceMs ?? null,
    });
    const aborted = await abortRun(runId, "user_stuck_retry");
    if (aborted) onRetry?.(aborted);
  };

  const busyType = busy.type;

  const stuckSeconds =
    state.stuckSinceMs != null ? Math.floor(state.stuckSinceMs / 1000) : null;

  const stillWorking = backgroundWorkerStillAlive || inFlightWork;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-3 mt-2 flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-foreground",
        className,
      )}
    >
      <IconAlertTriangle
        size={16}
        className="mt-0.5 shrink-0 text-amber-500"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="leading-snug">
          <span className="font-medium">
            {stillWorking
              ? "The agent is still working."
              : "This chat looks stuck."}
          </span>{" "}
          <span className="text-muted-foreground">
            No progress
            {stuckSeconds != null ? ` for ${stuckSeconds}s` : ""}.{" "}
            {inFlightWork
              ? "It's waiting on a call to another app or a long tool — canceling will stop that work."
              : backgroundWorkerStillAlive
                ? "The background worker is still alive; large updates can take a few minutes."
                : "The agent may have hit a server timeout or lost its connection."}
            {autoRetry && busyType === "retry"
              ? " Retrying automatically now."
              : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inFlightWork ? null : (
            <button
              type="button"
              onClick={handleRetry}
              disabled={busyType !== "none"}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyType === "retry" ? (
                <IconLoader2
                  size={12}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={handleCancel}
            disabled={busyType !== "none"}
            title={
              inFlightWork
                ? "Stop the in-progress run. Work that hasn't finished will be lost."
                : undefined
            }
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyType === "cancel" ? (
              <IconLoader2
                size={12}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
