let cached: string | undefined;

const STORAGE_KEY = "agent-native:browser-tab-id";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

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

/**
 * Stable id for the current browser tab.
 *
 * Backed by sessionStorage, so it survives reloads in the same tab. A fresh
 * document always claims a new id, even when the browser copied sessionStorage
 * while duplicating a tab. Use it to scope agent context to the tab: pass it
 * to the navigation-state writer (`useAgentRouteState`/`useNavigationState`)
 * and to `AgentSidebar`/`AgentPanel` so a chat reads the screen state of the
 * tab it was sent from, not whichever tab wrote the global key last.
 */
export function getBrowserTabId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    cached = generate();
    return cached;
  }
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (
      existing &&
      SAFE_BROWSER_TAB_ID_RE.test(existing) &&
      shouldReuseStoredTabId()
    ) {
      cached = existing;
      return existing;
    }
    const id = generate();
    sessionStorage.setItem(STORAGE_KEY, id);
    cached = id;
    return id;
  } catch {
    // SSR or storage unavailable — a per-call id is fine; the browser
    // re-evaluates this module on hydration and picks up the stored id.
    cached = generate();
    return cached;
  }
}
