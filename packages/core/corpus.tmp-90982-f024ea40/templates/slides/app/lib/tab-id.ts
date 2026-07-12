const STORAGE_KEY = "slides:browser-tab-id";
const BROADCAST_CHANNEL = "slides:tab-id-claims";

function createTabId() {
  return `slides-${Math.random().toString(36).slice(2, 10)}`;
}

const INSTANCE_ID = createTabId();

interface StoredTabClaim {
  tabId: string;
  ownerId?: string;
  active?: boolean;
}

function readStoredTabClaim(): StoredTabClaim | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
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
    // Older sessions stored the tab id as a plain string.
  }
  return { tabId: raw, active: false };
}

function writeStoredTabClaim(tabId: string, active: boolean) {
  window.sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ tabId, ownerId: INSTANCE_ID, active }),
  );
}

/**
 * Reading `sessionStorage` alone isn't enough: when a user duplicates a
 * browser tab, the new tab inherits the original's sessionStorage and would
 * read the same persisted id, causing both tabs to share the supposedly
 * tab-scoped app-state keys (`navigation:<id>`, `navigate:<id>`) — the exact
 * collision this refactor is meant to prevent.
 *
 * On boot we first check whether the stored id was copied from an active tab.
 * That catches duplicate-tab before this module exports TAB_ID. A
 * BroadcastChannel claim remains as a backstop for rare races; if it catches a
 * collision after export, the tab persists a fresh id and reloads so every
 * importer gets the same value.
 */
function getBrowserTabId(): string {
  if (typeof window === "undefined") return createTabId();
  try {
    const saved = readStoredTabClaim();
    const inheritedFromActiveTab =
      saved?.active === true &&
      typeof saved.ownerId === "string" &&
      saved.ownerId !== INSTANCE_ID;
    const id =
      saved?.tabId && !inheritedFromActiveTab ? saved.tabId : createTabId();
    writeStoredTabClaim(id, true);

    const markInactive = () => {
      try {
        const latest = readStoredTabClaim();
        if (latest?.tabId === id && latest.ownerId === INSTANCE_ID) {
          writeStoredTabClaim(id, false);
        }
      } catch {}
    };
    const markActive = () => {
      try {
        writeStoredTabClaim(id, true);
      } catch {}
    };
    window.addEventListener("pagehide", markInactive);
    window.addEventListener("pageshow", markActive);

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
          // We claimed an id that's already in use elsewhere. Consumers import
          // TAB_ID as a module constant, so the only safe way to change it is
          // to persist a fresh id and reload before this tab writes app-state.
          writeStoredTabClaim(createTabId(), true);
          channel.close();
          window.location.reload();
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
