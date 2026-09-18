import { useEffect, useState } from "react";

import {
  ACTIVE_RUN_STATE_EVENT,
  getActiveRun,
  type ActiveRunState,
} from "./active-run-state.js";

function sameRun(a: ActiveRunState | null, b: ActiveRunState | null): boolean {
  return a?.threadId === b?.threadId && a?.runId === b?.runId;
}

/** Return the focused run for a thread and keep it current as the stream moves. */
export function useActiveAgentChatRunId(
  threadId: string | null | undefined,
): string | null {
  const [activeRun, setActiveRunState] = useState<ActiveRunState | null>(() =>
    getActiveRun(),
  );

  useEffect(() => {
    const syncFromStorage = () =>
      setActiveRunState((current) => {
        const next = getActiveRun();
        return sameRun(current, next) ? current : next;
      });
    const handleActiveRunChange = (event: Event) => {
      const state = (event as CustomEvent<{ state?: ActiveRunState | null }>)
        .detail?.state;
      setActiveRunState((current) => {
        const next = state ?? null;
        return sameRun(current, next) ? current : next;
      });
    };

    syncFromStorage();
    window.addEventListener(ACTIVE_RUN_STATE_EVENT, handleActiveRunChange);
    window.addEventListener("storage", syncFromStorage);
    return () => {
      window.removeEventListener(ACTIVE_RUN_STATE_EVENT, handleActiveRunChange);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  return activeRun && activeRun.threadId === threadId ? activeRun.runId : null;
}
