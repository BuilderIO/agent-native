let cached: string | undefined;

const STORAGE_KEY = "agent-native:browser-tab-id";
const BROADCAST_CHANNEL = "agent-native:tab-id-claims";

function generate(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface StoredTabClaim {
  tabId: string;
  ownerId?: string;
  active?: boolean;
}

function readStoredClaim(): StoredTabClaim | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTabClaim> | null;
    if (parsed && typeof parsed.tabId === "string") {
      return {
        tabId: parsed.tabId,
        ownerId:
          typeof parsed.ownerId === "string" ? parsed.ownerId : undefined,
        active: parsed.active === true,
      };
    }
  } catch {
    // coercion-ok: not an error — old plain-string values fall through to
    // the return below, which treats the raw value as the tab id.
  }
  return { tabId: raw, active: false };
}

function writeStoredClaim(tabId: string, ownerId: string, active: boolean) {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ tabId, ownerId, active }),
  );
}

/**
 * Stable id for the current browser tab.
 *
 * Backed by sessionStorage, so it is unique per tab and survives reloads
 * within that tab. Every action and WebMCP call sends it as the
 * `X-Request-Source` header, and the server resolves tab-scoped
 * `application_state` keys (`${key}:${browserTabId}`) from that header — a
 * client that builds the same key locally, or passes an id as
 * `browserTabId`/`requestSource`/`ignoreSource`, must use this exact value or
 * it will silently miss the server's resolved key.
 *
 * Reading sessionStorage alone isn't enough: duplicating a browser tab copies
 * its sessionStorage, so the new tab would inherit the original's persisted id
 * and both tabs would share the same "tab-scoped" keys — the exact collision
 * this id exists to prevent. On boot we check whether the stored id was last
 * claimed by a still-active owner other than this instance (i.e. it was
 * copied from a tab that's still open) and mint a fresh one when it was. A
 * BroadcastChannel claim/ack is a backstop for the rare race where two tabs
 * finish that check in the same tick; catching a collision there reloads this
 * tab with a fresh id before it writes any tab-scoped state.
 */
export function getBrowserTabId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return generate();
  try {
    const ownerId = generate();
    const saved = readStoredClaim();
    const inheritedFromActiveOwner =
      saved?.active === true &&
      typeof saved.ownerId === "string" &&
      saved.ownerId !== ownerId;
    const id =
      saved?.tabId && !inheritedFromActiveOwner ? saved.tabId : generate();
    writeStoredClaim(id, ownerId, true);
    cached = id;

    window.addEventListener("pagehide", () => {
      try {
        const latest = readStoredClaim();
        if (latest?.tabId === id && latest.ownerId === ownerId) {
          writeStoredClaim(id, ownerId, false);
        }
      } catch {
        // coercion-ok: best-effort cleanup on tab close; sessionStorage
        // becoming unavailable here just skips marking the claim inactive.
      }
    });
    window.addEventListener("pageshow", () => {
      try {
        writeStoredClaim(id, ownerId, true);
      } catch {
        // coercion-ok: best-effort re-claim on tab show; the id stays
        // cached in memory even if this write fails.
      }
    });

    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL);
      channel.addEventListener("message", (event) => {
        const data = event.data as
          | { type: "claim"; id: string }
          | { type: "ack"; id: string }
          | null;
        if (!data) return;
        if (data.type === "claim" && data.id === id) {
          // Another tab is claiming our id — either it just booted and we
          // already had it, or this is a fresh duplicate-tab. Tell it we
          // already own this id; the duplicate-tab side will regenerate.
          channel.postMessage({ type: "ack", id });
        } else if (data.type === "ack" && data.id === id) {
          // We claimed an id that's already in use elsewhere. Callers may
          // already hold this value (e.g. via a module-level export), so the
          // only safe way to change it is to persist a fresh id and reload
          // before this tab writes any tab-scoped state.
          const freshId = generate();
          writeStoredClaim(freshId, ownerId, true);
          cached = freshId;
          channel.close();
          window.location.reload();
        }
      });
      channel.postMessage({ type: "claim", id });
    }

    return id;
  } catch {
    // SSR or storage unavailable — a per-call id is fine; the browser
    // re-evaluates this module on hydration and picks up the stored id.
    cached = generate();
    return cached;
  }
}
