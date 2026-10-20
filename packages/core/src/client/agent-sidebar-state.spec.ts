// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  consumeAgentSidebarUrlOpenOverride,
  clampAgentSidebarWidth,
  dispatchAgentSidebarStateChange,
  getAgentSidebarMaxWidth,
  getAgentSidebarOpenPreferenceKey,
  getAgentSidebarWideWidth,
  getInitialAgentSidebarOpen,
  hasChatThreadDeepLink,
  requestAgentSidebarOpen,
  SIDEBAR_OPEN_KEY,
  SIDEBAR_STATE_CHANGE_EVENT,
  setAgentSidebarOpenPreference,
  subscribeAgentSidebarUrlChanges,
} = await import("./agent-sidebar-state.js");

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 767px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function resetLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}

function resetSessionStorage() {
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("sessionStorage", storage);
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: storage,
  });
}

function stubUnreadableSessionStorage() {
  const storage = {
    clear: () => {
      throw new Error("session storage unavailable");
    },
    getItem: () => {
      throw new Error("session storage unavailable");
    },
    setItem: () => {
      throw new Error("session storage unavailable");
    },
    removeItem: () => {
      throw new Error("session storage unavailable");
    },
  };
  vi.stubGlobal("sessionStorage", storage);
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: storage,
  });
}

describe("agent sidebar width presets", () => {
  it("uses 75% of the desktop viewport for the wide preset", () => {
    expect(getAgentSidebarWideWidth(1440)).toBe(1080);
    expect(getAgentSidebarWideWidth(1024)).toBe(768);
  });

  it("keeps the existing 700px drag ceiling below the wide preset", () => {
    expect(getAgentSidebarMaxWidth(800)).toBe(700);
    expect(getAgentSidebarMaxWidth(1440)).toBe(1080);
  });

  it("clamps manual widths to the responsive maximum", () => {
    expect(clampAgentSidebarWidth(1200, 1024)).toBe(768);
    expect(clampAgentSidebarWidth(100, 1440)).toBe(280);
  });
});

describe("getInitialAgentSidebarOpen", () => {
  beforeEach(() => {
    resetLocalStorage();
    resetSessionStorage();
    window.history.replaceState(null, "", "/");
    stubMatchMedia(false);
  });

  it("uses the provided default when there is no saved preference", () => {
    expect(getInitialAgentSidebarOpen(true)).toBe(true);
    expect(getInitialAgentSidebarOpen(false)).toBe(false);
  });

  it("recognizes shared chat thread links", () => {
    window.history.replaceState(null, "", "/overview?thread=thread-1");
    expect(hasChatThreadDeepLink()).toBe(true);

    window.history.replaceState(null, "", "/overview?threadId=thread-2");
    expect(hasChatThreadDeepLink()).toBe(true);

    window.history.replaceState(null, "", "/overview?from=sidebar");
    expect(hasChatThreadDeepLink()).toBe(false);
  });

  it("opens for a shared chat thread link even when the sidebar defaults closed", () => {
    window.history.replaceState(null, "", "/overview?thread=thread-1");
    expect(getInitialAgentSidebarOpen(false)).toBe(true);

    window.history.replaceState(
      null,
      "",
      "/overview?thread=thread-1&agentSidebar=closed",
    );
    expect(getInitialAgentSidebarOpen(false)).toBe(false);
  });

  it("opens from the explicit sidebar URL hint", () => {
    window.history.replaceState(null, "", "/?agentSidebar=open");

    expect(getInitialAgentSidebarOpen(false)).toBe(true);
  });

  it("ignores both explicit URL values when URL overrides are ignored", () => {
    window.history.replaceState(null, "", "/?agentSidebar=open");
    expect(
      getInitialAgentSidebarOpen(false, undefined, { ignoreUrlOverride: true }),
    ).toBe(false);

    window.history.replaceState(null, "", "/?agentSidebar=closed");
    expect(
      getInitialAgentSidebarOpen(true, undefined, { ignoreUrlOverride: true }),
    ).toBe(true);
  });

  it("does not auto-open default-closed sidebars from saved state", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    expect(getInitialAgentSidebarOpen(false)).toBe(false);

    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "false");
    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });

  it("scopes saved sidebar state by storage key", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    setAgentSidebarOpenPreference(false, "docs");

    expect(getInitialAgentSidebarOpen(true, "plans")).toBe(true);
    expect(getInitialAgentSidebarOpen(true, "docs")).toBe(false);
    expect(getInitialAgentSidebarOpen(false, "plans")).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("true");
    expect(
      window.localStorage.getItem(getAgentSidebarOpenPreferenceKey("docs")),
    ).toBe("false");
  });

  it("can persist sidebar state and request a transient open", () => {
    const openEvents: string[] = [];
    window.addEventListener("agent-panel:open", () => openEvents.push("open"));

    setAgentSidebarOpenPreference(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("false");

    requestAgentSidebarOpen();

    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("false");
    expect(openEvents).toEqual(["open"]);
  });

  it("starts closed on mobile even with a saved open preference", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    stubMatchMedia(true);

    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });

  it("starts closed from an external-agent deep-link hint even with a saved open preference", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    window.history.replaceState(
      null,
      "",
      "/inbox?threadId=t1&agentSidebar=closed",
    );

    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });

  it("consumes the external-agent deep-link hint and persists the closed state", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    window.history.replaceState(
      null,
      "",
      "/inbox?threadId=t1&agentSidebar=closed#message",
    );

    expect(consumeAgentSidebarUrlOpenOverride("docs")).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("true");
    expect(
      window.localStorage.getItem(getAgentSidebarOpenPreferenceKey("docs")),
    ).toBe("false");
    expect(window.location.pathname).toBe("/inbox");
    expect(window.location.search).toBe("?threadId=t1");
    expect(window.location.hash).toBe("#message");
  });

  it("reacts when an already-mounted app shell receives the closed hint", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    const seen: Array<boolean | null> = [];
    const unsubscribe = subscribeAgentSidebarUrlChanges(() => {
      seen.push(consumeAgentSidebarUrlOpenOverride("docs"));
    });

    window.history.pushState(
      null,
      "",
      "/inbox?threadId=t1&agentSidebar=closed",
    );

    unsubscribe();
    expect(seen).toContain(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("true");
    expect(
      window.localStorage.getItem(getAgentSidebarOpenPreferenceKey("docs")),
    ).toBe("false");
    expect(window.location.pathname).toBe("/inbox");
    expect(window.location.search).toBe("?threadId=t1");
  });

  it("retains a consumed explicit open hint for a default-closed remount", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(window.location.search).toBe("");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
  });

  it("scopes consumed explicit open hints by sidebar storage key", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
    expect(getInitialAgentSidebarOpen(false, "content")).toBe(false);
  });

  it("clears consumed explicit open intent when the user closes the sidebar", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);

    expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(true);

    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("does not reopen after a user close when session intent clearing is denied", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });

    expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(false);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("gives an explicit URL close priority and clears consumed open intent", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);

    window.history.replaceState(null, "", "/overview?agentSidebar=closed");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(false);
    expect(window.location.search).toBe("");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("keeps an explicit URL close when session intent clearing is denied", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    window.history.replaceState(null, "", "/overview?agentSidebar=closed");
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(false);
    expect(window.location.search).toBe("?agentSidebar=closed");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
    window.history.replaceState(null, "", "/overview");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("retains explicit URL open behavior on mobile after consumption", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    stubMatchMedia(true);

    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
  });

  it("keeps an explicit open hint when session storage is unreadable", () => {
    stubUnreadableSessionStorage();
    window.history.replaceState(null, "", "/overview?agentSidebar=open");

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(window.location.search).toBe("?agentSidebar=open");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
    window.history.replaceState(null, "", "/overview");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("keeps an explicit open hint when session storage denies writes", () => {
    window.history.replaceState(null, "", "/overview?agentSidebar=open");
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(window.location.search).toBe("?agentSidebar=open");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
    window.history.replaceState(null, "", "/overview");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("lets a user close an open URL hint whose storage write failed", () => {
    window.history.replaceState(
      null,
      "",
      "/overview?keep=1&agentSidebar=open#section",
    );
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });

    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(window.location.search).toBe("?keep=1&agentSidebar=open");

    const seenOverrides: Array<boolean | null> = [];
    const unsubscribe = subscribeAgentSidebarUrlChanges(() => {
      seenOverrides.push(consumeAgentSidebarUrlOpenOverride("dispatch"));
    });
    try {
      expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(true);
      expect(window.location.search).toBe("?keep=1");
      expect(window.location.hash).toBe("#section");
      expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);

      window.history.pushState(null, "", "/overview?keep=2#section");
    } finally {
      unsubscribe();
    }

    expect(seenOverrides).toEqual([null, null]);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("keeps a closed URL hint when a user close cannot be persisted", () => {
    window.history.replaceState(
      null,
      "",
      "/overview?keep=1&agentSidebar=open#section",
    );
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);

    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("local storage write denied");
    });

    expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(false);
    expect(window.location.search).toBe("?keep=1&agentSidebar=closed");
    expect(window.location.hash).toBe("#section");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(false);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("keeps a close after a consumed open intent when both storage writes fail", () => {
    window.history.replaceState(
      null,
      "",
      "/overview?keep=1&agentSidebar=open#section",
    );
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
    expect(window.location.search).toBe("?keep=1");
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("session storage write denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("local storage write denied");
    });

    expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(false);
    expect(window.location.search).toBe("?keep=1&agentSidebar=closed");
    expect(window.location.hash).toBe("#section");
    expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(false);
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(false);
  });

  it("keeps an explicit open fallback when saving a user open fails without a URL hint", () => {
    window.history.replaceState(null, "", "/overview?keep=1#section");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("local storage write denied");
    });
    expect(setAgentSidebarOpenPreference(true, "dispatch")).toBe(false);
    expect(window.location.search).toBe("?keep=1&agentSidebar=open");
    expect(window.location.hash).toBe("#section");
    expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
  });

  it("lets a user reopen after a failed close replaced a stale open URL hint", () => {
    window.history.replaceState(
      null,
      "",
      "/overview?keep=1&agentSidebar=open#section",
    );
    const localStorageWrite = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("local storage write denied");
      });
    const seenOverrides: Array<boolean | null> = [];
    const unsubscribe = subscribeAgentSidebarUrlChanges(() => {
      seenOverrides.push(consumeAgentSidebarUrlOpenOverride("dispatch"));
    });
    try {
      expect(consumeAgentSidebarUrlOpenOverride("dispatch")).toBe(true);
      expect(window.location.search).toBe("?keep=1&agentSidebar=open");

      expect(setAgentSidebarOpenPreference(false, "dispatch")).toBe(false);
      expect(window.location.search).toBe("?keep=1&agentSidebar=closed");
      expect(seenOverrides).toEqual([false]);

      localStorageWrite.mockRestore();
      expect(setAgentSidebarOpenPreference(true, "dispatch")).toBe(true);
      expect(window.location.search).toBe("?keep=1");
      expect(window.location.hash).toBe("#section");
      expect(seenOverrides).toEqual([false, null]);
      expect(getInitialAgentSidebarOpen(false, "dispatch")).toBe(true);
    } finally {
      unsubscribe();
      localStorageWrite.mockRestore();
    }
  });
});

describe("dispatchAgentSidebarStateChange", () => {
  beforeEach(() => {
    resetLocalStorage();
    resetSessionStorage();
    window.history.replaceState(null, "", "/");
    stubMatchMedia(false);
  });

  it("emits a public state-change event with sidebar ownership details", () => {
    const listener = vi.fn();
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, listener);

    dispatchAgentSidebarStateChange({
      open: true,
      source: "frame",
      mode: "code",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      open: true,
      source: "frame",
      mode: "code",
    });

    window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, listener);
  });
});
