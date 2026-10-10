import { useEffect, useReducer } from "react";

import {
  ensureAgentEngineReadiness,
  getAgentEngineReadiness,
  subscribeAgentEngineReadiness,
  type AgentEngineConfiguredState,
  type AgentEngineReadinessSource,
} from "./agent-engine-readiness.js";

export {
  fetchAgentEngineConfiguredState,
  type AgentEngineConfiguredState,
  type FetchAgentEngineConfiguredStateOptions,
} from "./agent-engine-readiness.js";

export interface UseAgentEngineConfiguredResult {
  /** True only when the authoritative status confirms chat-eligible AI. */
  canChat: boolean;
  /** True only when the authoritative status says interactive chat is ineligible. */
  missing: boolean;
  state: AgentEngineConfiguredState;
}

export interface UseAgentEngineConfiguredOptions {
  tabId?: string | null;
  threadId?: string | null;
  source?: AgentEngineReadinessSource;
}

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

/**
 * Readiness is shared by every composer and dispatch path in this client
 * bundle. The initial probe starts on mount, and cached answers make sends
 * instant until the short readiness window expires.
 */
export function useAgentEngineConfigured(
  enabled = true,
  options?: UseAgentEngineConfiguredOptions,
): UseAgentEngineConfiguredResult {
  const [, forceRender] = useReducer((revision: number) => revision + 1, 0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    let lastAppliedState: AgentEngineConfiguredState | undefined;

    const applyState = (nextState: AgentEngineConfiguredState) => {
      if (cancelled) return;
      if (lastAppliedState === nextState && retryTimer !== undefined) return;
      lastAppliedState = nextState;
      forceRender();
      if (nextState === "configured" || nextState === "missing") {
        retryAttempt = 0;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        return;
      }
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
      retryAttempt += 1;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void check();
      }, delay);
    };

    const check = async () => {
      const nextState = enabled
        ? await ensureAgentEngineReadiness({ source: options?.source })
        : "configured";
      applyState(nextState);
    };

    const unsubscribe = subscribeAgentEngineReadiness(
      () => {
        applyState(getAgentEngineReadiness(options?.source));
      },
      { enabled, ...options },
    );
    const onVisibilityChange = () => {
      if (!document.hidden && retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void check();

    return () => {
      cancelled = true;
      unsubscribe();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, options?.source, options?.tabId, options?.threadId]);

  const effectiveState = enabled
    ? getAgentEngineReadiness(options?.source)
    : "configured";
  return {
    canChat: enabled && effectiveState === "configured",
    missing: enabled && effectiveState === "missing",
    state: effectiveState,
  };
}
