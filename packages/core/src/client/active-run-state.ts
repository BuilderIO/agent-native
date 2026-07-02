const STORAGE_KEY = "agent-chat-active-run";
export const ACTIVE_RUN_STATE_EVENT = "agent-chat:active-run-state-change";

export interface ActiveRunState {
  threadId: string;
  runId: string;
  lastSeq: number;
  activityTool?: string | null;
}

function notifyActiveRunStateChanged(state: ActiveRunState | null): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent === "undefined"
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(ACTIVE_RUN_STATE_EVENT, { detail: { state } }),
  );
}

function normalizeActivityTool(toolName: unknown): string | null {
  if (typeof toolName !== "string") return null;
  const tool = toolName.trim();
  return tool || null;
}

export function setActiveRun(state: ActiveRunState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  notifyActiveRunStateChanged(state);
}

export function getActiveRun(): ActiveRunState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function updateActiveRunSeq(seq: number): void {
  const state = getActiveRun();
  if (state) {
    state.lastSeq = seq;
    setActiveRun(state);
  }
}

export function updateActiveRunActivity(
  toolName: string | null | undefined,
): void {
  const state = getActiveRun();
  if (!state) return;
  const activityTool = normalizeActivityTool(toolName);
  if (activityTool) {
    setActiveRun({ ...state, activityTool });
    return;
  }
  const { activityTool: _activityTool, ...nextState } = state;
  setActiveRun(nextState);
}

export function getActiveRunActivityTool(
  threadId: string,
  runId: string,
): string | null {
  const stored = getActiveRun();
  if (stored?.threadId !== threadId || stored.runId !== runId) return null;
  return normalizeActivityTool(stored.activityTool);
}

export function clearActiveRun(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
  notifyActiveRunStateChanged(null);
}

export function clearActiveRunIfMatches(threadId: string, runId: string): void {
  const state = getActiveRun();
  if (state?.threadId !== threadId || state.runId !== runId) return;
  clearActiveRun();
}

/** Resume reconnect SSE after the last seen event (0 = replay from the start). */
export function resolveReconnectAfterSeq(
  threadId: string,
  runId: string,
): number {
  const stored = getActiveRun();
  if (
    stored?.threadId === threadId &&
    stored?.runId === runId &&
    Number.isFinite(stored.lastSeq)
  ) {
    return stored.lastSeq + 1;
  }
  return 0;
}
