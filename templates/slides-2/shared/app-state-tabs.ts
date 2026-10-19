const SAFE_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

export const SLIDES_2_APP_ID = "slides-2";

const APP_STATE_PREFIX = `${SLIDES_2_APP_ID}:`;

export function normalizeBrowserTabId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_TAB_ID_RE.test(trimmed) ? trimmed : null;
}

export function appStateKey(key: string): string {
  if (key === "navigation" || key.startsWith(APP_STATE_PREFIX)) return key;
  return `${APP_STATE_PREFIX}${key}`;
}

export function appStateKeyForBrowserTab(
  key: string,
  browserTabId: unknown,
): string {
  const normalized = normalizeBrowserTabId(browserTabId);
  if (key === "navigation") {
    return normalized
      ? `${APP_STATE_PREFIX}navigation:${normalized}`
      : `${APP_STATE_PREFIX}navigation`;
  }
  const namespacedKey = appStateKey(key);
  return normalized ? `${namespacedKey}:${normalized}` : namespacedKey;
}
