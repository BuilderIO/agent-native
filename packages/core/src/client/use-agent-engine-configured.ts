import { useEffect, useState } from "react";

import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import { agentNativePath } from "./api-path.js";

const PROVIDER_ENV_VAR_SET = new Set(PROVIDER_ENV_VARS);

/** `unknown` until the first check resolves, so callers don't flash the gate. */
export type AgentEngineConfiguredState = "unknown" | "configured" | "missing";

export interface UseAgentEngineConfiguredResult {
  /** True once we know nothing can run the agent (no key / Builder / BYOK). */
  missing: boolean;
  state: AgentEngineConfiguredState;
}

export interface FetchAgentEngineConfiguredStateOptions {
  missingFallback?: boolean;
  timeoutMs?: number;
}

const DEFAULT_STATUS_CHECK_TIMEOUT_MS = 2500;

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

  const request = fetch(
    agentNativePath(path),
    controller ? { signal: controller.signal } : undefined,
  )
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

  // All three failed — likely a flaky network; keep the caller in unknown
  // unless this check is reacting to an explicit missing-key stream event.
  if (envKeys == null && builderStatus == null && engineStatus == null) {
    return options?.missingFallback ? "missing" : "unknown";
  }

  const keys = (envKeys ?? []) as Array<{
    key: string;
    configured: boolean;
  }>;
  const llmKeys = keys.filter((k) => PROVIDER_ENV_VAR_SET.has(k.key));
  const anyConfigured =
    llmKeys.some((k) => k.configured) ||
    (hasConfiguredFlag(builderStatus) && builderStatus.configured) ||
    (hasConfiguredFlag(engineStatus) && engineStatus.configured);
  return anyConfigured ? "configured" : "missing";
}

/**
 * Shared "can the agent run?" gate — the single source of truth for the sidebar
 * composer and app prompt boxes. Checks the env-key / Builder / BYOK status
 * endpoints on mount, re-checks on `agent-engine:configured-changed`, and folds
 * in the adapter's `agent-chat:missing-api-key` signal. Pass `enabled = false`
 * to short-circuit to configured; flaky requests stay `unknown`.
 */
export function useAgentEngineConfigured(
  enabled = true,
): UseAgentEngineConfiguredResult {
  const [state, setState] = useState<AgentEngineConfiguredState>("unknown");

  useEffect(() => {
    let cancelled = false;
    const check = async (options?: { missingFallback?: boolean }) => {
      const nextState = await fetchAgentEngineConfiguredState(enabled, options);
      if (cancelled) return;
      if (nextState === "unknown") {
        return;
      }
      setState(nextState);
    };
    const onConfiguredChanged = () => {
      void check();
    };
    const onMissing = () => {
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
      window.removeEventListener(
        "agent-engine:configured-changed",
        onConfiguredChanged,
      );
      window.removeEventListener("agent-chat:missing-api-key", onMissing);
    };
  }, [enabled]);

  return { missing: state === "missing", state };
}
