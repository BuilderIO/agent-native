import { useEffect, useState } from "react";

import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import {
  fetchAgentEngineStatus,
  fetchBuilderStatus,
  fetchEnvironmentStatus,
  invalidateClientStatusRequest,
  type ClientStatusResult,
} from "./client-status-requests.js";
import { scheduleAfterPaint } from "./use-after-paint.js";

const PROVIDER_ENV_VAR_SET = new Set(PROVIDER_ENV_VARS);

export type AgentEngineConfiguredState =
  | "unknown"
  | "configured"
  | "missing"
  | "unavailable";

export interface UseAgentEngineConfiguredResult {
  missing: boolean;
  state: AgentEngineConfiguredState;
}

export interface FetchAgentEngineConfiguredStateOptions {
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

  return envKeysKnown && builderStatusKnown ? "missing" : "unavailable";
}

export function useAgentEngineConfigured(
  enabled = true,
  options?: UseAgentEngineConfiguredOptions,
): UseAgentEngineConfiguredResult {
  const [state, setState] = useState<AgentEngineConfiguredState>("unknown");

  useEffect(() => {
    let cancelled = false;
    let requestSeq = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    const scheduleRetry = (delay: number) => {
      retryTimer = setTimeout(() => {
        if (document.hidden) {
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
      if (nextState === "configured" || nextState === "missing") {
        retryAttempt = 0;
        return;
      }
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
      retryAttempt += 1;
      scheduleRetry(delay);
    };
    let initialCheckRan = false;
    const cancelInitialCheck = scheduleAfterPaint(() => {
      initialCheckRan = true;
      if (!cancelled) void check();
    });
    const checkNow: typeof check = (options) => {
      if (!initialCheckRan) {
        initialCheckRan = true;
        cancelInitialCheck();
      }
      return check(options);
    };
    const onConfiguredChanged = () => {
      checkNow();
    };
    const onMissing = (event: Event) => {
      if (!missingKeyEventMatchesScope(event, options)) return;
      if (!enabled) {
        setState("configured");
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

  return { missing: state === "missing", state };
}
