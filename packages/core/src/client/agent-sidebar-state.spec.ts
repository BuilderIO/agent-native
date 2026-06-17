// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  consumeAgentSidebarUrlOpenOverride,
  dispatchAgentSidebarStateChange,
  getInitialAgentSidebarOpen,
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

describe("getInitialAgentSidebarOpen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    stubMatchMedia(false);
  });

  it("uses the provided default when there is no saved preference", () => {
    expect(getInitialAgentSidebarOpen(true)).toBe(true);
    expect(getInitialAgentSidebarOpen(false)).toBe(false);
  });

  it("uses the saved desktop preference outside Builder", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    expect(getInitialAgentSidebarOpen(false)).toBe(true);

    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "false");
    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });

  it("can persist and request sidebar open state", () => {
    const openEvents: string[] = [];
    window.addEventListener("agent-panel:open", () => openEvents.push("open"));

    setAgentSidebarOpenPreference(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("false");

    requestAgentSidebarOpen();

    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("true");
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

    expect(consumeAgentSidebarUrlOpenOverride()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("false");
    expect(window.location.pathname).toBe("/inbox");
    expect(window.location.search).toBe("?threadId=t1");
    expect(window.location.hash).toBe("#message");
  });

  it("reacts when an already-mounted app shell receives the closed hint", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    const seen: Array<boolean | null> = [];
    const unsubscribe = subscribeAgentSidebarUrlChanges(() => {
      seen.push(consumeAgentSidebarUrlOpenOverride());
    });

    window.history.pushState(
      null,
      "",
      "/inbox?threadId=t1&agentSidebar=closed",
    );

    unsubscribe();
    expect(seen).toContain(false);
    expect(window.localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("false");
    expect(window.location.pathname).toBe("/inbox");
    expect(window.location.search).toBe("?threadId=t1");
  });
});

describe("dispatchAgentSidebarStateChange", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
