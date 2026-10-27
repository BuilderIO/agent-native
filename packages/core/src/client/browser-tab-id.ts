import { appBasePath, isWorkspaceRuntime } from "./api-path.js";

const STORAGE_KEY = "agent-native:browser-tab-id";
const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
const BROWSER_TAB_ID_STATE_SYMBOL = Symbol.for(
  "@agent-native/core/client/browser-tab-id",
);

type BrowserTabIdState = {
  ids: Map<string, string>;
  pendingId: string | null;
};

const browserTabIdGlobal = globalThis as typeof globalThis & {
  [BROWSER_TAB_ID_STATE_SYMBOL]?: BrowserTabIdState;
};
// Vite can load optimized package and deep-import copies in the same tab.
const browserTabIdState =
  browserTabIdGlobal[BROWSER_TAB_ID_STATE_SYMBOL] ??
  (browserTabIdGlobal[BROWSER_TAB_ID_STATE_SYMBOL] = {
    ids: new Map(),
    pendingId: null,
  });
browserTabIdState.pendingId ??= null;
let serverCached: string | undefined;

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
  if (typeof window === "undefined") {
    serverCached ??= generate();
    return serverCached;
  }

  let key: string;
  try {
    key = storageKey();
  } catch {
    return getOrCreatePendingId();
  }

  const cached = browserTabIdState.ids.get(key);
  if (cached) {
    browserTabIdState.pendingId = null;
    return cached;
  }

  let existing: string | null;
  try {
    existing = sessionStorage.getItem(key);
  } catch {
    const pending = browserTabIdState.pendingId;
    if (pending) {
      browserTabIdState.pendingId = null;
      browserTabIdState.ids.set(key, pending);
      return pending;
    }
    return getOrCreateMemoryId(key);
  }

  if (
    existing &&
    SAFE_BROWSER_TAB_ID_RE.test(existing) &&
    shouldReuseStoredTabId()
  ) {
    browserTabIdState.pendingId = null;
    browserTabIdState.ids.set(key, existing);
    return existing;
  }

  const id = browserTabIdState.pendingId ?? generate();
  browserTabIdState.pendingId = null;
  try {
    sessionStorage.setItem(key, id);
  } catch {
    browserTabIdState.ids.set(key, id);
    return id;
  }
  browserTabIdState.ids.set(key, id);
  return id;
}

export function isBrowserTabIdForCurrentDocument(tabId?: string): boolean {
  if (typeof tabId !== "string") return false;
  if (browserTabIdState.pendingId === tabId) return true;
  for (const knownTabId of browserTabIdState.ids.values()) {
    if (knownTabId === tabId) return true;
  }
  return false;
}

function getOrCreateMemoryId(key: string): string {
  const cached = browserTabIdState.ids.get(key);
  if (cached) return cached;
  const id = generate();
  browserTabIdState.ids.set(key, id);
  return id;
}

function getOrCreatePendingId(): string {
  browserTabIdState.pendingId ??= generate();
  return browserTabIdState.pendingId;
}
