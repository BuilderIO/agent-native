import { useEffect, useState } from "react";

import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import {
  fetchAgentEngineStatus,
  fetchBuilderStatus,
  fetchEnvironmentStatus,
  invalidateClientStatusRequest,
  type ClientStatusResult,
} from "./client-status-requests.js";

const PROVIDER_ENV_VAR_SET = new Set(PROVIDER_ENV_VARS);

/**
 * Three distinct situations, never collapsed:
 * - `configured` / `missing` are authoritative answers from the status routes.
 * - `unknown` (first check in flight) and `unavailable` (the check failed, a
 *   retry is scheduled) both mean *we do not know*. Neither is evidence that
 *   no provider is configured, so neither may gate the composer.
 */
export type AgentEngineConfiguredState =
  | "unknown"
  | "configured"
  | "missing"
  | "unavailable";

export interface UseAgentEngineConfiguredResult {
  /** True once we know nothing can run the agent (no key / Builder / BYOK). */
  missing: boolean;
  state: AgentEngineConfiguredState;
}

export interface FetchAgentEngineConfiguredStateOptions {
  /**
   * Legacy hint from explicit missing-key stream events. Kept for API
   * compatibility, but missing state still requires authoritative status
   * responses so transient endpoint failures do not clobber connected state.
   */
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

function hasConfiguredFlag(value: unknown): value is { configured: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "configured" in value &&
    typeof (value as { configured?: unknown }).configured === "boolean"
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
    engineResult.state === "available" &&
    hasConfiguredFlag(engineResult.value)
  ) {
    return engineResult.value.configured ? "configured" : "missing";
  }

  // Older hosts may not expose the canonical route. Only then pay for the two
  // legacy probes; current hosts answer readiness with one request.
  const [envResult, builderResult] = await Promise.all([
    waitForStatus(
      fetchEnvironmentStatus(),
      "/_agent-native/env-status",
      timeoutMs,
    ),
    waitForStatus(
      fetchBuilderStatus(),
      "/_agent-native/builder/status",
      timeoutMs,
    ),
  ]);
  const envKeys = envResult.state === "available" ? envResult.value : undefined;
  const builderStatus =
    builderResult.state === "available" ? builderResult.value : undefined;
  const envKeysKnown = Array.isArray(envKeys);
  const builderStatusKnown = hasConfiguredFlag(builderStatus);
  const keys = envKeysKnown
    ? (envKeys as Array<{
        key: string;
        configured: boolean;
      }>)
    : [];
  const llmKeys = keys.filter((k) => PROVIDER_ENV_VAR_SET.has(k.key));
  const anyConfigured =
    llmKeys.some((k) => k.configured) ||
    (builderStatusKnown && builderStatus.configured);
  if (anyConfigured) return "configured";

  // Compatibility fallback for older hosts without the canonical route.
  return envKeysKnown && builderStatusKnown ? "missing" : "unavailable";
}

/**
 * Shared "can the agent run?" gate — the single source of truth for the sidebar
 * composer and app prompt boxes. Checks the env-key / Builder / BYOK status
 * endpoints on mount, re-checks on `agent-engine:configured-changed`, and folds
 * in the adapter's `agent-chat:missing-api-key` signal. Pass `enabled = false`
 * to short-circuit to configured. A check that cannot reach an authoritative
 * answer retries on a backoff until it does, so the gate can never latch.
 */
export function useAgentEngineConfigured(
  enabled = true,
  options?: UseAgentEngineConfiguredOptions,
): UseAgentEngineConfiguredResult {
  const [state, setState] = useState<AgentEngineConfiguredState>("unknown");

  useEffect(() => {
    let cancelled = false;
    // Monotonic call counter: overlapping checks (mount + a
    // `agent-engine:configured-changed` fired right after a key is saved) can
    // resolve out of order; only the latest call may write state, or a slow
    // stale "missing" response would overwrite the fresh "configured" one.
    let requestSeq = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const check = async (options?: { missingFallback?: boolean }) => {
      const seq = ++requestSeq;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      const nextState = await fetchAgentEngineConfiguredState(enabled, options);
      if (cancelled || seq !== requestSeq) return;
      setState(nextState === "unknown" ? "unavailable" : nextState);
      if (nextState === "configured" || nextState === "missing") {
        retryAttempt = 0;
        return;
      }
      // No authoritative answer yet. Keep asking: a failed probe that latched
      // permanently is what left users staring at a dead composer with no way
      // back short of a reload.
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        void check();
      }, delay);
    };
    const onConfiguredChanged = () => {
      void check();
    };
    const onMissing = (event: Event) => {
      if (!missingKeyEventMatchesScope(event, options)) return;
      if (!enabled) {
        setState("configured");
        return;
      }
      void check({ missingFallback: true });
    };

    void check();
    window.addEventListener(
      "agent-engine:configured-changed",
      onConfiguredChanged,
    );
    // A stale failed stream can arrive after a reconnect succeeds. Re-check the
    // current status before pinning the composer in setup.
    window.addEventListener("agent-chat:missing-api-key", onMissing);
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      window.removeEventListener(
        "agent-engine:configured-changed",
        onConfiguredChanged,
      );
      window.removeEventListener("agent-chat:missing-api-key", onMissing);
    };
  }, [enabled, options?.tabId, options?.threadId]);

  return { missing: state === "missing", state };
}
