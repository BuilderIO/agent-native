export const ANALYTICS_CHAT_STORAGE_KEY = "analytics";

export const ANALYTICS_RECENT_CHAT_HANDOFF_TTL_MS = 5 * 60 * 1000;

const ANALYTICS_LAST_CHAT_ACTIVITY_KEY =
  "agent-native.analytics.last-chat-activity-at";

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
