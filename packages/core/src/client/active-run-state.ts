const STORAGE_KEY = "agent-chat-active-run";

export interface ActiveRunState {
  threadId: string;
  runId: string;
  lastSeq: number;
}

export function setActiveRun(state: ActiveRunState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
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

export function clearActiveRun(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
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
