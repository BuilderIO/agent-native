import { useEffect, useState } from "react";

import {
  ACTIVE_RUN_STATE_EVENT,
  getActiveRun,
  type ActiveRunState,
} from "./active-run-state.js";

/** Return the focused run for a thread and keep it current as the stream moves. */
export function useActiveAgentChatRunId(
  threadId: string | null | undefined,
): string | null {
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(() =>
    getActiveRun(),
  );

  useEffect(() => {
    const syncFromStorage = () => setActiveRun(getActiveRun());
    const handleActiveRunChange = (event: Event) => {
      const state = (event as CustomEvent<{ state?: ActiveRunState | null }>)
        .detail?.state;
      setActiveRun(state ?? null);
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
