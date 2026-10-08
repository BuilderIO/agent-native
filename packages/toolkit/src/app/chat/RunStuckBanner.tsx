import {
  useRunStuckDetection,
  useAbortRun,
  type RunStuckState,
} from "@agent-native/core/client/agent-chat";
import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit/utils";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

export interface RunStuckBannerProps {
  threadId: string | null | undefined;
  enabled?: boolean;
  apiUrl?: string;
  stuckThresholdMs?: number;
  onRetry?: (runId: string) => void;
  hasInFlightWork?: () => boolean;
  isAwaitingResponse?: () => boolean;
  onStuckStateChange?: (state: RunStuckState) => void;
  /**
   * The server has stopped tracking a run this chat still shows as running.
   * Resolves `settled` once the chat no longer shows it running; rejects when
   * the thread could not be refreshed.
   */
  onServerSettled?: () => Promise<RunReconcileOutcome>;
  autoRetry?: boolean;
  autoRetryOwnerId?: string;
  className?: string;
}

export type RunReconcileOutcome = "settled" | "still_running";

const RECONCILE_RETRY_MS = 30_000;
const AUTO_RETRY_CLAIM_TTL_MS = 5 * 60 * 1000;
const BACKGROUND_WORKER_FRESH_HEARTBEAT_MS = 30_000;

/**
 * Per page, not per banner: a chat view that remounts while the same run is
 * still stuck has not found a new stuck chat.
 */
const reportedStuckRunIds = new Set<string>();

type BusyState = { type: "none" } | { type: "cancel" | "retry"; runId: string };

// Only the click that set busy for `runId` may clear it.
const releaseBusy =
  (runId: string) =>
  (current: BusyState): BusyState =>
    current.type !== "none" && current.runId === runId
      ? { type: "none" }
      : current;

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
    return true;
  }
}

/**
 * A run the user cancelled or retried must stay out of auto-retry across a
 * reload too: the claim every owner checks is the one place that survives it, so
 * the click takes the claim for itself. Best effort, like the claim itself.
 */
function markUserActedOnRun(
  threadId: string | null | undefined,
  runId: string,
) {
  if (!threadId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      autoRetryClaimKey(threadId, runId),
      JSON.stringify({
        ownerId: "user-action",
        expiresAt: Date.now() + AUTO_RETRY_CLAIM_TTL_MS,
      }),
    );
  } catch {
    // The in-memory marker still covers this mount.
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
  onServerSettled,
  autoRetry = false,
  autoRetryOwnerId,
  hasInFlightWork,
  isAwaitingResponse,
  className,
}: RunStuckBannerProps) {
  const t = useT();
  const chatAwaiting = isAwaitingResponse?.();
  const state = useRunStuckDetection({
    threadId,
    enabled,
    awaitingResponse: chatAwaiting,
    stuckThresholdMs,
    apiUrl,
  });
  const abortRun = useAbortRun(apiUrl);
  const [busy, setBusy] = useState<BusyState>({ type: "none" });
  const [autoRetriedRunId, setAutoRetriedRunId] = useState<string | null>(null);
  const autoRetriedRunIdsRef = useRef<Set<string>>(new Set());
  // A run the user already acted on is never auto-retried: a failed Cancel frees
  // `busy` again, and an auto-retry gated on other state must not then resume it.
  const userActedRunIdsRef = useRef<Set<string>>(new Set());
  const generatedOwnerIdRef = useRef<string | null>(null);
  if (!generatedOwnerIdRef.current) {
    generatedOwnerIdRef.current = createAutoRetryOwnerId();
  }
  const ownerId = autoRetryOwnerId ?? generatedOwnerIdRef.current;
  const backgroundWorkerStillAlive = isFreshBackgroundWorker(state);
  const inFlightWork =
    state.hasInFlightWork === true || (hasInFlightWork?.() ?? false);
  const awaitingResponse = chatAwaiting ?? true;
  // While the status is unreadable `isStuck` is the last answer carried forward
  // by the clock, not a fresh one: only the unreadable notice may speak, and
  // nothing may abort a run on it.
  const isStuck = state.isStuck && !state.statusUnreadable;
  const showsStuckBanner =
    isStuck &&
    !!state.runId &&
    !backgroundWorkerStillAlive &&
    !inFlightWork &&
    awaitingResponse;
  const isServerContinuedDispatch =
    state.dispatchMode === "foreground-self-chain" ||
    state.dispatchMode?.startsWith("background") === true;

  // Only a host that says when the chat is waiting can tell a lost ending from
  // an idle chat, so reconciling needs `isAwaitingResponse`.
  const chatShowsRunning = isAwaitingResponse != null && awaitingResponse;
  const settledWhileRunning = chatShowsRunning && state.serverSettled;
  const [reconcile, setReconcile] = useState<"idle" | "failed" | "unsettled">(
    "idle",
  );
  const lastReconcileAtRef = useRef(0);
  const reconcileEpochRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // `state` changes on every poll, so a reconcile that did not settle the chat
  // is retried at most once per RECONCILE_RETRY_MS, never in a loop.
  useEffect(() => {
    if (!settledWhileRunning || !onServerSettled) {
      // A reload still in flight answers a chat that has since moved on.
      reconcileEpochRef.current += 1;
      lastReconcileAtRef.current = 0;
      setReconcile("idle");
      return;
    }
    const now = Date.now();
    if (now - lastReconcileAtRef.current < RECONCILE_RETRY_MS) return;
    lastReconcileAtRef.current = now;
    const epoch = reconcileEpochRef.current;
    const current = () =>
      mountedRef.current && epoch === reconcileEpochRef.current;
    onServerSettled().then(
      (outcome) => {
        if (current()) {
          setReconcile(outcome === "settled" ? "idle" : "unsettled");
        }
      },
      () => {
        if (current()) setReconcile("failed");
      },
    );
  }, [onServerSettled, settledWhileRunning, state]);

  const lastReportedRef = useRef<{
    isStuck: boolean;
    runId: string | null;
  }>({ isStuck: false, runId: null });
  useEffect(() => {
    const last = lastReportedRef.current;
    if (last.isStuck === state.isStuck && last.runId === state.runId) return;
    lastReportedRef.current = { isStuck: state.isStuck, runId: state.runId };
    onStuckStateChange?.(state);
  }, [state, onStuckStateChange]);

  // Analytics counts this event as a stuck chat, so it fires only when the
  // banner shows, once per run: a quiet tool call or live worker is not one.
  useEffect(() => {
    if (!showsStuckBanner || !state.runId) return;
    if (reportedStuckRunIds.has(state.runId)) return;
    reportedStuckRunIds.add(state.runId);
    trackEvent("agent_chat_stuck_detected", {
      runId: state.runId,
      threadId: threadId ?? null,
      stuckSinceMs: state.stuckSinceMs ?? null,
      stuckSinceSec:
        state.stuckSinceMs != null
          ? Math.floor(state.stuckSinceMs / 1000)
          : null,
      runStatus: state.status,
      reason: "no_progress",
      dispatchMode: state.dispatchMode,
      hasInFlightWork: state.hasInFlightWork,
      heartbeatSinceSec:
        state.heartbeatSinceMs != null
          ? Math.floor(state.heartbeatSinceMs / 1000)
          : null,
    });
  }, [showsStuckBanner, state, threadId]);

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
      isServerContinuedDispatch ||
      backgroundWorkerStillAlive ||
      inFlightWork ||
      !awaitingResponse ||
      !isStuck ||
      !state.runId ||
      busy.type !== "none" ||
      autoRetriedRunIdsRef.current.has(state.runId) ||
      userActedRunIdsRef.current.has(state.runId)
    ) {
      return;
    }

    const runId = state.runId;
    void claimAutoRetryAttempt(threadId, runId, ownerId).then((claimed) => {
      autoRetriedRunIdsRef.current.add(runId);
      if (!claimed || userActedRunIdsRef.current.has(runId)) return;
      setBusy({ type: "retry", runId });
      setAutoRetriedRunId(runId);
      trackEvent("agent_chat_stuck_auto_retry", {
        runId,
        threadId: threadId ?? null,
        stuckSinceMs: state.stuckSinceMs ?? null,
      });
      void abortRun(runId, "auto_stuck_retry").then((aborted) => {
        setBusy(releaseBusy(runId));
        if (aborted) onRetry?.(aborted);
      });
    });
  }, [
    abortRun,
    autoRetry,
    backgroundWorkerStillAlive,
    busy,
    inFlightWork,
    isServerContinuedDispatch,
    isStuck,
    onRetry,
    ownerId,
    state.runId,
    state.stuckSinceMs,
    threadId,
    awaitingResponse,
  ]);

  if (!showsStuckBanner) {
    const notice =
      reconcile === "unsettled"
        ? "agentChat.recovery.statusMismatch"
        : (isAwaitingResponse
              ? awaitingResponse
              : state.status === "running") &&
            (state.statusUnreadable || reconcile === "failed")
          ? "agentChat.recovery.statusUnreadable"
          : null;
    if (!notice) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "mx-3 mt-2 flex items-center gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-foreground",
          className,
        )}
      >
        <IconAlertTriangle
          size={16}
          className="shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 leading-snug">{t(notice)}</span>
        {reconcile === "unsettled" ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
          >
            {t("agentChat.recovery.reload")}
          </button>
        ) : null}
      </div>
    );
  }

  const handleCancel = async () => {
    if (!state.runId || busy.type !== "none") return;
    const runId = state.runId;
    userActedRunIdsRef.current.add(runId);
    markUserActedOnRun(threadId, runId);
    setBusy({ type: "cancel", runId });
    trackEvent("agent_chat_stuck_cancel", {
      runId,
      threadId: threadId ?? null,
      stuckSinceMs: state.stuckSinceMs ?? null,
    });
    // A replaced run clears busy through the state effect; a failed abort never
    // replaces it, so the buttons would stay disabled for the same stuck run.
    if (!(await abortRun(runId, "user_stuck_cancel"))) {
      setBusy(releaseBusy(runId));
    }
  };

  const handleRetry = async () => {
    if (
      !state.runId ||
      busy.type !== "none" ||
      backgroundWorkerStillAlive ||
      inFlightWork
    ) {
      return;
    }
    const runId = state.runId;
    userActedRunIdsRef.current.add(runId);
    markUserActedOnRun(threadId, runId);
    setBusy({ type: "retry", runId });
    trackEvent("agent_chat_stuck_retry", {
      runId,
      threadId: threadId ?? null,
      stuckSinceMs: state.stuckSinceMs ?? null,
    });
    const aborted = await abortRun(runId, "user_stuck_retry");
    if (aborted) onRetry?.(aborted);
    else setBusy(releaseBusy(runId));
  };

  const busyType = busy.type;

  const stuckSeconds =
    state.stuckSinceMs != null ? Math.floor(state.stuckSinceMs / 1000) : null;

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
            {t("agentChat.recovery.stuckTitle")}
          </span>{" "}
          <span className="text-muted-foreground">
            {t(
              stuckSeconds != null
                ? "agentChat.recovery.stuckWithDuration"
                : "agentChat.recovery.stuckNoProgress",
              stuckSeconds != null ? { seconds: stuckSeconds } : undefined,
            )}
            {autoRetry && autoRetriedRunId === state.runId
              ? ` ${t("agentChat.recovery.stuckRetrying")}`
              : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            {t("agentChat.common.retry")}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busyType !== "none"}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyType === "cancel" ? (
              <IconLoader2
                size={12}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {t("agentChat.common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
