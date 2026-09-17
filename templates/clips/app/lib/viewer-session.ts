const VIEWER_SESSION_STORAGE_KEY = "clips-view-session-id";
let inMemoryViewerSessionId: string | null = null;

function fallbackSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getViewerSessionId(): string {
  if (typeof window === "undefined") {
    if (inMemoryViewerSessionId) return inMemoryViewerSessionId;
    inMemoryViewerSessionId = fallbackSessionId();
    return inMemoryViewerSessionId;
  }

  try {
    const existing = window.localStorage.getItem(VIEWER_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : fallbackSessionId();
    window.localStorage.setItem(VIEWER_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    if (inMemoryViewerSessionId) return inMemoryViewerSessionId;
    inMemoryViewerSessionId = fallbackSessionId();
    return inMemoryViewerSessionId;
  }
}
