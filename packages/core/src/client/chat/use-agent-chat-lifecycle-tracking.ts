import { useCallback, useEffect, useRef } from "react";

import {
  ACTIVE_RUN_STATE_EVENT,
  getActiveRun,
  type ActiveRunState,
} from "../active-run-state.js";
import { trackAgentChatLifecycle } from "../analytics.js";

export interface AgentChatLifecycleTrackingOptions {
  surface: string;
  threadId?: string;
  tabId?: string;
  onActiveRunChange?: (active: boolean) => void;
}

export function useAgentChatLifecycleTracking({
  surface,
  threadId,
  tabId,
  onActiveRunChange,
}: AgentChatLifecycleTrackingOptions): (runId?: string) => void {
  const activeRef = useRef<boolean | null>(null);
  const observedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    trackAgentChatLifecycle({
      phase: "surface-mounted",
      surface,
      ...(threadId ? { threadId } : {}),
      ...(tabId ? { tabId } : {}),
    });
  }, [surface, tabId, threadId]);

  useEffect(() => {
    const sync = (state = getActiveRun()) => {
      const active = Boolean(
        threadId && state?.threadId === threadId && state.runId,
      );
      if (activeRef.current !== active) {
        activeRef.current = active;
        onActiveRunChange?.(active);
      }
      if (!active || !state) return;
      if (observedRunIdRef.current === state.runId) return;
      observedRunIdRef.current = state.runId;
      trackAgentChatLifecycle({
        phase: "run-observed",
        surface,
        threadId: state.threadId,
        runId: state.runId,
        ...(tabId ? { tabId } : {}),
      });
    };
    sync();
    const activeRunHandler = (event: Event) => {
      const state = (event as CustomEvent<{ state?: ActiveRunState | null }>)
        .detail?.state;
      sync(state ?? null);
    };
    const storageHandler = () => sync();
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, activeRunHandler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(ACTIVE_RUN_STATE_EVENT, activeRunHandler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [onActiveRunChange, surface, tabId, threadId]);

  return useCallback(
    (runId?: string) => {
      trackAgentChatLifecycle({
        phase: "run-stopped",
        surface,
        ...(threadId ? { threadId } : {}),
        ...(runId ? { runId } : {}),
        ...(tabId ? { tabId } : {}),
      });
    },
    [surface, tabId, threadId],
  );
}
