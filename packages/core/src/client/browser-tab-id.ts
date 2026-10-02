import { appBasePath, isWorkspaceRuntime } from "./api-path.js";

let cached: string | undefined;

const STORAGE_KEY = "agent-native:browser-tab-id";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function storageKey(): string {
  const appScope = isWorkspaceRuntime() ? appBasePath() : "";
  return appScope ? `${STORAGE_KEY}:${appScope}` : STORAGE_KEY;
}

function generate(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function shouldReuseStoredTabId(): boolean {
  if (typeof performance === "undefined") return true;
  const navigation = performance.getEntriesByType?.("navigation")?.[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!navigation) return true;
  return navigation?.type === "reload" || navigation?.type === "back_forward";
}

export function getBrowserTabId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = generate();
    return cached;
  }
  try {
    const key = storageKey();
    const existing = sessionStorage.getItem(key);
    if (
      existing &&
      SAFE_BROWSER_TAB_ID_RE.test(existing) &&
      shouldReuseStoredTabId()
    ) {
      cached = existing;
      return existing;
    }
    const id = generate();
    sessionStorage.setItem(key, id);
    cached = id;
    return id;
  } catch {
    cached = generate();
    return cached;
  }
}
