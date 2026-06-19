const STORAGE_KEY = "agent-native.forms.tab-id";
const SAFE_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function randomTabId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function readStoredTabId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored && SAFE_TAB_ID_RE.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredTabId(tabId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, tabId);
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory id still works.
  }
}

function shouldReuseStoredTabId(): boolean {
  if (typeof performance === "undefined") return true;
  const navigation = performance.getEntriesByType?.("navigation")?.[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!navigation) return true;
  return navigation.type === "reload" || navigation.type === "back_forward";
}

function createTabId() {
  const stored = readStoredTabId();
  if (stored && shouldReuseStoredTabId()) return stored;
  const tabId = randomTabId();
  writeStoredTabId(tabId);
  return tabId;
}

export const TAB_ID = createTabId();
