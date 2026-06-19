import { useEffect, useState } from "react";
import { agentNativePath } from "./api-path.js";
import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";

const PROVIDER_ENV_VAR_SET = new Set(PROVIDER_ENV_VARS);

/** `unknown` until the first check resolves, so callers don't flash the gate. */
export type AgentEngineConfiguredState = "unknown" | "configured" | "missing";

export interface UseAgentEngineConfiguredResult {
  /** True once we know nothing can run the agent (no key / Builder / BYOK). */
  missing: boolean;
  state: AgentEngineConfiguredState;
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

  // Mid-run adapter signal that no key is usable — honored even when disabled.
  useEffect(() => {
    const onMissing = () => setState("missing");
    window.addEventListener("agent-chat:missing-api-key", onMissing);
    return () =>
      window.removeEventListener("agent-chat:missing-api-key", onMissing);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState("configured");
      return;
    }
    let cancelled = false;
    const check = async () => {
      const [envKeys, builderStatus, engineStatus] = await Promise.all([
        fetch(agentNativePath("/_agent-native/env-status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(agentNativePath("/_agent-native/builder/status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(agentNativePath("/_agent-native/agent-engine/status"))
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      // All three failed — likely a flaky network; keep the current state.
      if (envKeys == null && builderStatus == null && engineStatus == null) {
        return;
      }
      const keys = (envKeys ?? []) as Array<{
        key: string;
        configured: boolean;
      }>;
      const llmKeys = keys.filter((k) => PROVIDER_ENV_VAR_SET.has(k.key));
      const anyConfigured =
        llmKeys.some((k) => k.configured) ||
        builderStatus?.configured === true ||
        engineStatus?.configured === true;
      setState(anyConfigured ? "configured" : "missing");
    };
    void check();
    window.addEventListener("agent-engine:configured-changed", check);
    return () => {
      cancelled = true;
      window.removeEventListener("agent-engine:configured-changed", check);
    };
  }, [enabled]);

  return { missing: state === "missing", state };
}
