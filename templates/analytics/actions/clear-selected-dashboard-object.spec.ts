import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

const appStateKeyForBrowserTab = vi.fn(
  (key: string, browserTabId: string | null) =>
    browserTabId ? `${key}:${browserTabId}` : key,
);
const compareAndSetAppState = vi.fn();
const getCurrentRequestBrowserTabId = vi.fn(() => "test-tab");
const readAppState = vi.fn();
const readAppStateForCurrentTab = vi.fn();
vi.mock("@agent-native/core/application-state", () => ({
  appStateKeyForBrowserTab,
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
  readAppState,
  readAppStateForCurrentTab,
}));

const action = (await import("./clear-selected-dashboard-object.js")).default;

describe("clear-selected-dashboard-object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareAndSetAppState.mockResolvedValue(true);
    getCurrentRequestBrowserTabId.mockReturnValue("test-tab");
    readAppState.mockResolvedValue(null);
    readAppStateForCurrentTab.mockResolvedValue(null);
  });

  it.each([
    {
      type: "dashboard",
      id: "dash-1",
    },
    {
      type: "dashboard-panel",
      dashboardId: "dash-1",
      panelId: "panel-1",
    },
  ])("atomically clears an owned $type selection", async (selection) => {
    const current = {
      ...selection,
      __agentNativeSelectedObjectSource: "test-tab",
    };
    readAppStateForCurrentTab.mockResolvedValue(current);

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: true });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object:test-tab",
      current,
      null,
    );
    expect(readAppStateForCurrentTab).toHaveBeenCalledWith("selected-object", {
      fallbackToGlobal: false,
    });
  });

  it("does not clear a selection owned by another tab", async () => {
    readAppStateForCurrentTab.mockResolvedValue({
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "other-tab",
    });

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: false });
    expect(compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not let an old dashboard cleanup clear the next dashboard", async () => {
    readAppStateForCurrentTab.mockResolvedValue({
      type: "dashboard",
      id: "dash-2",
      __agentNativeSelectedObjectSource: "test-tab",
    });

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: false });
    expect(compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("keeps a newer selection when compare-and-set loses a race", async () => {
    const current = {
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "test-tab",
    };
    readAppStateForCurrentTab.mockResolvedValue(current);
    compareAndSetAppState.mockResolvedValue(false);

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: false });
  });

  it("uses the Ask mount selection as the compare-and-set expectation", async () => {
    const originalSelection = {
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "test-tab",
    };
    const newerSelection = {
      type: "dashboard-panel",
      dashboardId: "dash-1",
      panelId: "panel-2",
      __agentNativeSelectedObjectSource: "test-tab",
    };
    readAppStateForCurrentTab.mockResolvedValue(newerSelection);
    compareAndSetAppState.mockResolvedValue(false);

    await expect(
      action.run({
        expectedSelection: originalSelection,
        source: "test-tab",
      }),
    ).resolves.toEqual({ cleared: false });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object:test-tab",
      originalSelection,
      null,
    );
  });

  it("falls back to the legacy global key when no tab-scoped selection exists", async () => {
    const current = {
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "test-tab",
    };
    readAppStateForCurrentTab.mockResolvedValue(null);
    readAppState.mockResolvedValue(current);

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: true });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object",
      current,
      null,
    );
  });
});
