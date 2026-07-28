const STORAGE_KEY = "agent-chat-active-run";
const PENDING_TURN_STORAGE_KEY = "agent-chat-pending-turn";
export const ACTIVE_RUN_STATE_EVENT = "agent-chat:active-run-state-change";

export interface ActiveRunState {
  threadId: string;
  runId: string;
  lastSeq: number;
  activityTool?: string | null;
}

export interface PendingTurnState {
  threadId: string;
  turnId: string;
}

/**
 * Active runs, keyed by thread.
 *
 * This used to be a single record: whichever thread started a run last owned
 * the slot. Two chats running at once meant the second erased the first's
 * `lastSeq` (so its reconnect replayed from zero) and any code reading the slot
 * without checking `threadId` acted on a stranger's run — stopping one chat
 * could abort another's. Every accessor is therefore addressed by thread; the
 * only way to ask "what is running anywhere" is {@link listActiveRuns}, which
 * hands back all of them rather than picking one.
 */
type ActiveRunsByThread = Record<string, ActiveRunState>;

function isActiveRunState(value: unknown): value is ActiveRunState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActiveRunState>;
  return (
    typeof candidate.threadId === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.lastSeq === "number"
  );
}

function readActiveRuns(): ActiveRunsByThread {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    // A run in flight when this shipped still has the old single-record shape.
    if (isActiveRunState(parsed)) return { [parsed.threadId]: parsed };
    const runs: ActiveRunsByThread = {};
    for (const [threadId, state] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (isActiveRunState(state)) runs[threadId] = state;
    }
    return runs;
  } catch {
    return {};
  }
}

function writeActiveRuns(runs: ActiveRunsByThread): void {
  try {
    if (Object.keys(runs).length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {}
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
  const runs = readActiveRuns();
  runs[state.threadId] = state;
  writeActiveRuns(runs);
  notifyActiveRunStateChanged(state);
}

/** The run in flight for `threadId`, or null. Never another thread's run. */
export function getActiveRun(
  threadId: string | undefined,
): ActiveRunState | null {
  if (!threadId) return null;
  return readActiveRuns()[threadId] ?? null;
}

/**
 * Every run currently in flight. For callers with no thread in hand (feedback
 * context, trace-id fallbacks) that must decide for themselves what to do when
 * more than one run is active, rather than silently getting one of them.
 */
export function listActiveRuns(): ActiveRunState[] {
  return Object.values(readActiveRuns());
}

export function updateActiveRunSeq(
  threadId: string | undefined,
  seq: number,
): void {
  const state = getActiveRun(threadId);
  if (!state) return;
  setActiveRun({ ...state, lastSeq: seq });
}

export function updateActiveRunActivity(
  threadId: string | undefined,
  toolName: string | null | undefined,
): void {
  const state = getActiveRun(threadId);
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
  const stored = getActiveRun(threadId);
  if (!stored || stored.runId !== runId) return null;
  return normalizeActivityTool(stored.activityTool);
}

/** Forget `threadId`'s run. Other threads' runs are left alone. */
export function clearActiveRun(threadId: string | undefined): void {
  if (!threadId) return;
  const runs = readActiveRuns();
  if (!(threadId in runs)) return;
  delete runs[threadId];
  writeActiveRuns(runs);
  notifyActiveRunStateChanged(null);
}

export function clearActiveRunIfMatches(threadId: string, runId: string): void {
  const state = getActiveRun(threadId);
  if (!state || state.runId !== runId) return;
  clearActiveRun(threadId);
}

export function setPendingTurn(state: PendingTurnState): void {
  try {
    sessionStorage.setItem(PENDING_TURN_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function getPendingTurn(threadId: string): PendingTurnState | null {
  try {
    const raw = sessionStorage.getItem(PENDING_TURN_STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as PendingTurnState;
    return state.threadId === threadId && state.turnId ? state : null;
  } catch {
    return null;
  }
}

export function clearPendingTurnIfMatches(
  threadId: string,
  turnId?: string,
): void {
  const state = getPendingTurn(threadId);
  if (!state || (turnId && state.turnId !== turnId)) return;
  try {
    sessionStorage.removeItem(PENDING_TURN_STORAGE_KEY);
  } catch {}
}

/** Resume reconnect SSE after the last seen event (0 = replay from the start). */
export function resolveReconnectAfterSeq(
  threadId: string,
  runId: string,
): number {
  const stored = getActiveRun(threadId);
  if (stored?.runId === runId && Number.isFinite(stored.lastSeq)) {
    return stored.lastSeq + 1;
  }
  return 0;
}
