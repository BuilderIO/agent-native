import { getActiveRun } from "./active-run-state.js";

export interface FeedbackClientContext {
  chatSessionIds: string[];
  activeRunId?: string;
  pageUrl?: string;
}

const ACTIVE_THREAD_KEY_PREFIX = "agent-chat-active-thread";
const MAX_CHAT_SESSION_IDS = 5;

function isThreadStorageKey(key: string): boolean {
  return (
    key === ACTIVE_THREAD_KEY_PREFIX ||
    (key.startsWith(`${ACTIVE_THREAD_KEY_PREFIX}:`) && !key.endsWith(":seen"))
  );
}

function readSeenAt(key: string): number {
  try {
    const raw = localStorage.getItem(`${key}:seen`);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) ids.add(trimmed);
}

function recentStoredThreadIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const candidates: Array<{ id: string; seenAt: number }> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !isThreadStorageKey(key)) continue;
      const id = localStorage.getItem(key)?.trim();
      if (!id) continue;
      candidates.push({ id, seenAt: readSeenAt(key) });
    }
    candidates.sort((a, b) => b.seenAt - a.seenAt);
    return candidates.map((candidate) => candidate.id);
  } catch {
    return [];
  }
}

export function getFeedbackClientContext(
  chatSessionId?: string | null,
): FeedbackClientContext {
  const ids = new Set<string>();
  addId(ids, chatSessionId);

  const activeRun = typeof window !== "undefined" ? getActiveRun() : null;
  addId(ids, activeRun?.threadId);

  for (const id of recentStoredThreadIds()) {
    addId(ids, id);
    if (ids.size >= MAX_CHAT_SESSION_IDS) break;
  }

  const context: FeedbackClientContext = {
    chatSessionIds: [...ids].slice(0, MAX_CHAT_SESSION_IDS),
  };
  if (activeRun?.runId) context.activeRunId = activeRun.runId;
  if (typeof window !== "undefined") context.pageUrl = window.location.href;
  return context;
}
