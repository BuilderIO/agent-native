import {
  consumeAgentChatHomeHandoff,
  markAgentChatHomeHandoff,
  resolveAgentChatRunningThreadId,
  type AgentChatRunningEventDetail,
} from "@agent-native/core/client/agent-chat";

export const ANALYTICS_CHAT_STORAGE_KEY = "analytics";

export const ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS = 5 * 60 * 1000;

export type AnalyticsChatRunningRuns = Map<
  string,
  { runIds: Set<string>; unidentifiedRunActive: boolean }
>;

const ANALYTICS_LAST_CHAT_ACTIVITY_KEY =
  "agent-native.analytics.last-chat-activity-at";

export function isAnalyticsSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function discardAnalyticsChatHandoffOnSettings(pathname: string): void {
  if (!isAnalyticsSettingsPath(pathname)) return;
  consumeAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY, {
    ttlMs: ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS,
  });
}

export function updateAnalyticsChatHandoffForRun(
  runningRuns: AnalyticsChatRunningRuns,
  detail: unknown,
  pathname: string,
): void {
  if (!detail || typeof detail !== "object") return;
  const run = detail as Partial<AgentChatRunningEventDetail>;
  if (typeof run.isRunning !== "boolean") return;
  const tabId = resolveAgentChatRunningThreadId(run);
  if (!tabId) return;
  const runId = typeof run.runId === "string" && run.runId ? run.runId : null;
  const state = runningRuns.get(tabId);

  if (run.isRunning) {
    if (pathname !== "/ask") return;
    const next = state ?? {
      runIds: new Set<string>(),
      unidentifiedRunActive: false,
    };
    if (runId) {
      next.unidentifiedRunActive = false;
      next.runIds.add(runId);
    } else {
      next.unidentifiedRunActive = true;
    }
    runningRuns.set(tabId, next);
    markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);
    return;
  }

  if (!state) return;
  let hadActiveRun = false;
  if (runId) {
    hadActiveRun = state.runIds.delete(runId);
    if (!hadActiveRun && state.unidentifiedRunActive) {
      state.unidentifiedRunActive = false;
      hadActiveRun = true;
    }
  } else if (state.unidentifiedRunActive) {
    state.unidentifiedRunActive = false;
    hadActiveRun = true;
  } else if (state.runIds.size === 1) {
    state.runIds.clear();
    hadActiveRun = true;
  } else {
    hadActiveRun = state.runIds.size > 1;
  }

  if (!state.unidentifiedRunActive && state.runIds.size === 0) {
    runningRuns.delete(tabId);
  }
  if (hadActiveRun && pathname === "/ask") {
    markAgentChatHomeHandoff(ANALYTICS_CHAT_STORAGE_KEY);
  }
}

function readAnalyticsLastChatActivityAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(ANALYTICS_LAST_CHAT_ACTIVITY_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function markAnalyticsChatActivity(now = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ANALYTICS_LAST_CHAT_ACTIVITY_KEY,
      String(now),
    );
  } catch {}
}

export function hasRecentAnalyticsChat(now = Date.now()): boolean {
  const lastChatAt = readAnalyticsLastChatActivityAt();
  return (
    lastChatAt > 0 && now - lastChatAt <= ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS
  );
}
