import { useEffect, useState } from "react";

import {
  fetchAgentEngineStatus,
  invalidateClientStatusRequest,
  type ClientStatusResult,
} from "./client-status-requests.js";
import { scheduleAfterPaint } from "./use-after-paint.js";

/**
 * Three distinct situations, never collapsed:
 * - `configured` / `missing` are authoritative chat-eligibility answers.
 * - `unknown` (first check in flight) and `unavailable` (the check failed, a
 *   retry is scheduled) both mean *we do not know*. Neither is evidence that
 *   chat is eligible, so the composer stays unavailable until a retry succeeds.
 */
export type AgentEngineConfiguredState =
  | "unknown"
  | "configured"
  | "missing"
  | "unavailable";

export interface UseAgentEngineConfiguredResult {
  /** True only when the authoritative status confirms chat-eligible AI. */
  canChat: boolean;
  /** True only when the authoritative status says interactive chat is ineligible. */
  missing: boolean;
  state: AgentEngineConfiguredState;
}

export interface FetchAgentEngineConfiguredStateOptions {
  /** Kept for API compatibility; readiness always comes from chatEligible. */
  missingFallback?: boolean;
  timeoutMs?: number;
}

export interface UseAgentEngineConfiguredOptions {
  tabId?: string | null;
  threadId?: string | null;
}

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

async function waitForStatus<T>(
  request: Promise<ClientStatusResult<T>>,
  path: string,
  timeoutMs: number | undefined,
): Promise<ClientStatusResult<T>> {
  if (timeoutMs === undefined) return request;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ClientStatusResult<T>>((resolve) => {
    timeoutId = setTimeout(() => {
      // A request that loses this race may never settle. Evict and abort the
      // shared probe so the scheduled retry starts a genuinely new request.
      invalidateClientStatusRequest(path);
      resolve({ state: "unavailable" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function hasChatEligibleFlag(
  value: unknown,
): value is { chatEligible: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "chatEligible" in value &&
    typeof (value as { chatEligible?: unknown }).chatEligible === "boolean"
  );
}

function missingKeyEventMatchesScope(
  event: Event,
  options: UseAgentEngineConfiguredOptions | undefined,
): boolean {
  const detail = (event as CustomEvent).detail as
    | { tabId?: unknown; threadId?: unknown }
    | undefined;
  const eventTabId = typeof detail?.tabId === "string" ? detail.tabId : null;
  const eventThreadId =
    typeof detail?.threadId === "string" ? detail.threadId : null;
  if (!eventTabId && !eventThreadId) return true;

  const tabId = options?.tabId ?? null;
  const threadId = options?.threadId ?? null;
  if (!tabId && !threadId) return true;
  return (
    (eventTabId != null && eventTabId === tabId) ||
    (eventThreadId != null && eventThreadId === threadId)
  );
}

export async function fetchAgentEngineConfiguredState(
  enabled = true,
  options?: FetchAgentEngineConfiguredStateOptions,
): Promise<AgentEngineConfiguredState> {
  if (!enabled) return "configured";

  const timeoutMs =
    typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const engineResult = await waitForStatus(
    fetchAgentEngineStatus(),
    "/_agent-native/agent-engine/status",
    timeoutMs,
  );
  if (
    engineResult.state !== "available" ||
    !hasChatEligibleFlag(engineResult.value)
  ) {
    // A reachable legacy server may expose only the broad `configured` flag.
    // It cannot prove this stricter chat-specific policy, so fail closed and
    // let the existing retry loop refresh after the server is upgraded.
    return "unavailable";
  }
  return engineResult.value.chatEligible ? "configured" : "missing";
}

/**
 * Shared interactive-chat gate — its status comes only from the canonical
 * chat-specific eligibility field. Pass `enabled = false` to preserve the
 * legacy status short-circuit; `canChat` remains false in that mode. A check
 * without an authoritative answer retries on a backoff until it does.
 */
export function useAgentEngineConfigured(
  enabled = true,
  options?: UseAgentEngineConfiguredOptions,
): UseAgentEngineConfiguredResult {
  const [state, setState] = useState<AgentEngineConfiguredState>("unknown");
  const [canChat, setCanChat] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Monotonic call counter: overlapping checks (mount + a
    // `agent-engine:configured-changed` fired right after a key is saved) can
    // resolve out of order; only the latest call may write state, or a slow
    // stale "missing" response would overwrite the fresh "configured" one.
    let requestSeq = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const scheduleRetry = (delay: number) => {
      retryTimer = setTimeout(() => {
        if (document.hidden) {
          // Tab is backgrounded — keep the same backoff instead of hitting
          // the network; the visibilitychange listener below recovers fast.
          scheduleRetry(delay);
          return;
        }
        void check();
      }, delay);
    };
    const check = async (options?: { missingFallback?: boolean }) => {
      const seq = ++requestSeq;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      const nextState = await fetchAgentEngineConfiguredState(enabled, options);
      if (cancelled || seq !== requestSeq) return;
      setState(nextState === "unknown" ? "unavailable" : nextState);
      setCanChat(enabled && nextState === "configured");
      if (nextState === "configured" || nextState === "missing") {
        retryAttempt = 0;
        return;
      }
      // No authoritative answer yet. Keep asking: a failed probe that latched
      // permanently is what left users staring at a dead composer with no way
      // back short of a reload.
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
      retryAttempt += 1;
      scheduleRetry(delay);
    };
    // The composer gate is not visible during first paint; defer the initial
    // probe so it does not compete in the startup window. Event-driven
    // re-checks below stay immediate.
    let initialCheckRan = false;
    const cancelInitialCheck = scheduleAfterPaint(() => {
      initialCheckRan = true;
      if (!cancelled) void check();
    });
    // An event inside the deferral window consumes the scheduled initial
    // probe, so one client-status request lands immediately instead of two
    // when the window elapses.
    const checkNow: typeof check = (options) => {
      if (!initialCheckRan) {
        initialCheckRan = true;
        cancelInitialCheck();
      }
      return check(options);
    };
    const onConfiguredChanged = () => {
      // Read after the shared client-status cache invalidates in its listener.
      queueMicrotask(() => {
        if (!cancelled) checkNow();
      });
    };
    const onMissing = (event: Event) => {
      if (!missingKeyEventMatchesScope(event, options)) return;
      if (!enabled) {
        setState("configured");
        setCanChat(false);
        return;
      }
      checkNow({ missingFallback: true });
    };
    const onVisibilityChange = () => {
      if (!document.hidden && retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        void check();
      }
    };

    window.addEventListener(
      "agent-engine:configured-changed",
      onConfiguredChanged,
    );
    // A stale failed stream can arrive after a reconnect succeeds. Re-check the
    // current status before pinning the composer in setup.
    window.addEventListener("agent-chat:missing-api-key", onMissing);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      cancelInitialCheck();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(
        "agent-engine:configured-changed",
        onConfiguredChanged,
      );
      window.removeEventListener("agent-chat:missing-api-key", onMissing);
    };
  }, [enabled, options?.tabId, options?.threadId]);

  return {
    canChat: enabled && canChat,
    missing: state === "missing",
    state,
  };
}
