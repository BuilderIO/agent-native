import { listActiveRuns } from "./active-run-state.js";
import { getClientSurface, type ClientSurface } from "./client-surface.js";
import { scrubUrl } from "./url-scrub.js";

export interface FeedbackClientContext {
  chatSessionIds: string[];
  activeRunId?: string;
  pageUrl?: string;
  /** Runtime shell the feedback was sent from: web, electron, or tauri. */
  clientSurface?: ClientSurface;
}

export interface FeedbackClientContextOptions {
  chatSessionId?: string | null;
  storageKey?: string | null;
}

const ACTIVE_THREAD_KEY_PREFIX = "agent-chat-active-thread";
const MAX_CHAT_SESSION_IDS = 5;

function isThreadStorageKey(key: string, storageKey?: string | null): boolean {
  if (key.endsWith(":seen")) return false;
  if (storageKey) {
    const namespaced = `${ACTIVE_THREAD_KEY_PREFIX}:${storageKey}`;
    return key === namespaced || key.startsWith(`${namespaced}:scope:`);
  }
  return (
    key === ACTIVE_THREAD_KEY_PREFIX ||
    key.startsWith(`${ACTIVE_THREAD_KEY_PREFIX}:scope:`)
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

function recentStoredThreadIds(storageKey?: string | null): string[] {
  if (typeof window === "undefined") return [];
  try {
    const candidates: Array<{ id: string; seenAt: number }> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !isThreadStorageKey(key, storageKey)) continue;
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
  options: FeedbackClientContextOptions = {},
): FeedbackClientContext {
  const ids = new Set<string>();
  addId(ids, options.chatSessionId);

  // Every in-flight run is a candidate session for this feedback. With more
  // than one running there is no basis for picking a single `activeRunId`, so
  // none is reported rather than attaching feedback to an arbitrary run.
  const activeRuns = typeof window !== "undefined" ? listActiveRuns() : [];
  for (const run of activeRuns) addId(ids, run.threadId);

  for (const id of recentStoredThreadIds(options.storageKey)) {
    addId(ids, id);
    if (ids.size >= MAX_CHAT_SESSION_IDS) break;
  }

  const context: FeedbackClientContext = {
    chatSessionIds: [...ids].slice(0, MAX_CHAT_SESSION_IDS),
  };
  const onlyActiveRun = activeRuns.length === 1 ? activeRuns[0] : null;
  if (onlyActiveRun?.runId) context.activeRunId = onlyActiveRun.runId;
  if (typeof window !== "undefined") {
    context.pageUrl = scrubUrl(window.location.href);
    context.clientSurface = getClientSurface();
  }
  return context;
}
