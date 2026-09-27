import { serializeAnalyticsAnonymousIdCookie } from "../shared/analytics-anonymous-id.js";

const ANONYMOUS_ID_STORAGE_KEY = "agent-native.anonymous_id";
const SESSION_ID_STORAGE_KEY = "agent-native.session_id";
const SESSION_ID_PIN_STORAGE_KEY = "agent-native.session_id_pin";
const SESSION_LAST_ACTIVITY_STORAGE_KEY = "agent-native.session_last_activity";
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SESSION_ID_LENGTH = 127;
const SAFE_SESSION_ID = /^[!-~]+$/;

function generateVisitorId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to Math.random
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private browsing / storage disabled -- best-effort
  }
}

function safeStorageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
    // coercion-ok: storage that refuses writes holds no key to clear, so the caller's end state already holds
  } catch {
    // private browsing / storage disabled -- best-effort
  }
}

function syncAnalyticsAnonymousIdCookie(id: string): void {
  try {
    const cookie = serializeAnalyticsAnonymousIdCookie(id);
    if (cookie) document.cookie = cookie;
  } catch {
    // Cookie access can be unavailable in sandboxed frames — local storage
    // remains the browser-side source of truth in that case.
  }
}

export function getOrCreateAnalyticsAnonymousId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  let id = safeStorageGet(ANONYMOUS_ID_STORAGE_KEY);
  if (!id) {
    id = generateVisitorId();
    safeStorageSet(ANONYMOUS_ID_STORAGE_KEY, id);
  }
  syncAnalyticsAnonymousIdCookie(id);
  return id;
}

export function setAnalyticsSessionId(sessionId: string): string | undefined {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  if (
    !trimmed ||
    trimmed.length > MAX_SESSION_ID_LENGTH ||
    !SAFE_SESSION_ID.test(trimmed)
  ) {
    throw new Error(
      `Invalid analytics session id: expected 1-${MAX_SESSION_ID_LENGTH} printable ASCII characters with no whitespace`,
    );
  }
  if (typeof window === "undefined") return undefined;
  safeStorageSet(SESSION_ID_PIN_STORAGE_KEY, trimmed);
  safeStorageSet(SESSION_ID_STORAGE_KEY, trimmed);
  safeStorageSet(SESSION_LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
  return trimmed;
}

export function clearAnalyticsSessionId(): void {
  if (typeof window === "undefined") return;
  safeStorageRemove(SESSION_ID_PIN_STORAGE_KEY);
  safeStorageRemove(SESSION_ID_STORAGE_KEY);
  safeStorageRemove(SESSION_LAST_ACTIVITY_STORAGE_KEY);
}

export function getOrCreateAnalyticsSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const now = Date.now();
  const pinned = safeStorageGet(SESSION_ID_PIN_STORAGE_KEY);
  if (pinned) {
    safeStorageSet(SESSION_ID_STORAGE_KEY, pinned);
    safeStorageSet(SESSION_LAST_ACTIVITY_STORAGE_KEY, String(now));
    return pinned;
  }
  const lastActivityRaw = safeStorageGet(SESSION_LAST_ACTIVITY_STORAGE_KEY);
  const lastActivity = lastActivityRaw
    ? Number.parseInt(lastActivityRaw, 10)
    : 0;
  let id = safeStorageGet(SESSION_ID_STORAGE_KEY);
  const expired =
    !lastActivity ||
    Number.isNaN(lastActivity) ||
    now - lastActivity > SESSION_IDLE_TIMEOUT_MS;
  if (!id || expired) {
    id = generateVisitorId();
    safeStorageSet(SESSION_ID_STORAGE_KEY, id);
  }
  safeStorageSet(SESSION_LAST_ACTIVITY_STORAGE_KEY, String(now));
  return id;
}
