import { useEffect, useState } from "react";

import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import { agentNativePath } from "./api-path.js";

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

// Abort ceiling for a hung request, NOT a deadline the probes race against.
// `/agent-engine/status` resolves session, org context, a scoped secret and a
// settings row — several DB round-trips that measured ~4.7s on a warm local
// dev server, so any budget short enough to "feel fast" just manufactures a
// fake answer. Losing this ceiling is treated as "don't know", never "missing".
const DEFAULT_STATUS_CHECK_TIMEOUT_MS = 15000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

async function fetchStatusJson(
  path: string,
  timeoutMs: number,
): Promise<unknown | null> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      resolve(null);
    }, timeoutMs);
  });

  // Never serve a stale status from the HTTP cache: this is re-fetched right
  // after a provider connects, and a cached "missing" would keep the composer
  // gate and error banner pinned even though a provider is now configured.
  const request = fetch(agentNativePath(path), {
    cache: "no-store",
    ...(controller ? { signal: controller.signal } : {}),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });

  return Promise.race([request, timeout]);
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
      : DEFAULT_STATUS_CHECK_TIMEOUT_MS;
  const [envKeys, builderStatus, engineStatus] = await Promise.all([
    fetchStatusJson("/_agent-native/env-status", timeoutMs),
    fetchStatusJson("/_agent-native/builder/status", timeoutMs),
    fetchStatusJson("/_agent-native/agent-engine/status", timeoutMs),
  ]);

  // All three failed — surface a retryable unavailable state instead of
  // leaving the composer in an infinite checking loop.
  if (envKeys == null && builderStatus == null && engineStatus == null) {
    return "unavailable";
  }

  const envKeysKnown = Array.isArray(envKeys);
  const builderStatusKnown = hasConfiguredFlag(builderStatus);
  const engineStatusKnown = hasConfiguredFlag(engineStatus);
  const keys = envKeysKnown
    ? (envKeys as Array<{
        key: string;
        configured: boolean;
      }>)
    : [];
  const llmKeys = keys.filter((k) => PROVIDER_ENV_VAR_SET.has(k.key));
  const anyConfigured =
    llmKeys.some((k) => k.configured) ||
    (builderStatusKnown && builderStatus.configured) ||
    (engineStatusKnown && engineStatus.configured);
  if (anyConfigured) return "configured";

  // The engine status route is the canonical readiness check: it resolves
  // Builder, scoped BYOK secrets, deployment credentials, and custom engines.
  // Once it has answered `configured: false`, a slow legacy env/Builder status
  // request must not leave the composer permissively stuck in `unknown`.
  if (engineStatusKnown) return "missing";

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
