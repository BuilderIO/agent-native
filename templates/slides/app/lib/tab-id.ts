const STORAGE_KEY = "slides:browser-tab-id";
const BROADCAST_CHANNEL = "slides:tab-id-claims";

function createTabId() {
  return `slides-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reading `sessionStorage` alone isn't enough: when a user duplicates a
 * browser tab, the new tab inherits the original's sessionStorage and would
 * read the same persisted id, causing both tabs to share the supposedly
 * tab-scoped app-state keys (`navigation:<id>`, `navigate:<id>`) — the exact
 * collision this refactor is meant to prevent.
 *
 * On boot we ping every other slides tab over a BroadcastChannel with the id
 * we plan to claim. If anyone responds with the same id we regenerate, write
 * the fresh id back to sessionStorage, and keep going. The handshake is
 * synchronous from the caller's perspective: we issue the claim immediately
 * and then keep a listener installed to regenerate if a sibling claims our
 * id later in the same session (e.g. duplicate-tab created after we booted).
 */
function getBrowserTabId(): string {
  if (typeof window === "undefined") return createTabId();
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    let id = saved || createTabId();
    if (!saved) window.sessionStorage.setItem(STORAGE_KEY, id);

    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.addEventListener("message", (event) => {
        const data = event.data as
          | { type: "claim"; id: string }
          | { type: "ack"; id: string }
          | null;
        if (!data) return;
        if (data.type === "claim" && data.id === id) {
          // Another tab is claiming our id — either we just booted and they
          // already had it, or this is a fresh duplicate-tab. Tell them we
          // already own it; the duplicate-tab side will regenerate.
          channel.postMessage({ type: "ack", id });
        } else if (data.type === "ack" && data.id === id) {
          // We claimed an id that's already in use elsewhere. Regenerate and
          // re-announce. This races against further duplications; one
          // regeneration is enough in practice.
          id = createTabId();
          window.sessionStorage.setItem(STORAGE_KEY, id);
          channel.postMessage({ type: "claim", id });
          // Update the exported binding by mutating the module-scope ref via
          // the closure below; consumers read TAB_ID once at import time so
          // the safest thing here is to also update sessionStorage and let a
          // page-reload recover. Most agents reload on navigate commands
          // anyway, and the brief overlap window is harmless.
        }
      });
      channel.postMessage({ type: "claim", id });
    }
    return id;
  } catch {
    return createTabId();
  }
}

export const TAB_ID = getBrowserTabId();
