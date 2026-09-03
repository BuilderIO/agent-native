let cached: string | undefined;

const STORAGE_KEY = "agent-native:browser-tab-id";

function generate(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Stable id for the current browser tab.
 *
 * Backed by sessionStorage, so it is unique per tab and survives reloads
 * within that tab. Use it to scope agent context to the tab: pass it to the
 * navigation-state writer (`useAgentRouteState`/`useNavigationState`) and to
 * `AgentSidebar`/`AgentPanel` so a chat reads the screen state of the tab it
 * was sent from, not whichever tab wrote the global key last.
 */
export function getBrowserTabId(): string {
  if (cached) return cached;
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
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
