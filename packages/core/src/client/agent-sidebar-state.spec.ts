// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const frameState = vi.hoisted(() => ({ inBuilderFrame: false }));

vi.mock("./builder-frame.js", () => ({
  isInBuilderFrame: () => frameState.inBuilderFrame,
}));

const {
  dispatchAgentSidebarStateChange,
  getInitialAgentSidebarOpen,
  SIDEBAR_OPEN_KEY,
  SIDEBAR_STATE_CHANGE_EVENT,
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
    frameState.inBuilderFrame = false;
    window.localStorage.clear();
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

  it("starts closed on mobile even with a saved open preference", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    stubMatchMedia(true);

    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });

  it("starts closed in Builder even with a saved open preference", () => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, "true");
    frameState.inBuilderFrame = true;

    expect(getInitialAgentSidebarOpen(true)).toBe(false);
  });
});

describe("dispatchAgentSidebarStateChange", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
