const STORAGE_KEY = "slides:browser-tab-id";

function createTabId() {
  return `slides-${Math.random().toString(36).slice(2, 10)}`;
}

function getBrowserTabId() {
  if (typeof window === "undefined") return createTabId();
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    const next = createTabId();
    window.sessionStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return createTabId();
  }
}

export const TAB_ID = getBrowserTabId();
