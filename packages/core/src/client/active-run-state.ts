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
