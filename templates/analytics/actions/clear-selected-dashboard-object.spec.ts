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
vi.mock("@agent-native/core/application-state", () => ({
  appStateKeyForBrowserTab,
  compareAndSetAppState,
  getCurrentRequestBrowserTabId,
  readAppState,
}));

const action = (await import("./clear-selected-dashboard-object.js")).default;

describe("clear-selected-dashboard-object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareAndSetAppState.mockResolvedValue(true);
    getCurrentRequestBrowserTabId.mockReturnValue("test-tab");
    readAppState.mockResolvedValue(null);
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
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:test-tab" ? current : null,
    );

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: true });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object:test-tab",
      current,
      null,
    );
    expect(readAppState).toHaveBeenCalledWith("selected-object:test-tab");
  });

  it("does not clear a selection owned by another tab", async () => {
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:test-tab"
        ? {
            type: "dashboard",
            id: "dash-1",
            __agentNativeSelectedObjectSource: "other-tab",
          }
        : null,
    );

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: false });
    expect(compareAndSetAppState).not.toHaveBeenCalled();
  });

  it("does not let an old dashboard cleanup clear the next dashboard", async () => {
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:test-tab"
        ? {
            type: "dashboard",
            id: "dash-2",
            __agentNativeSelectedObjectSource: "test-tab",
          }
        : null,
    );

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
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:test-tab" ? current : null,
    );
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
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:test-tab" ? newerSelection : null,
    );
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
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object" ? current : null,
    );

    await expect(
      action.run({ dashboardId: "dash-1", source: "test-tab" }),
    ).resolves.toEqual({ cleared: true });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object",
      current,
      null,
    );
  });

  it("uses the caller-provided browser tab id when request context is absent", async () => {
    const current = {
      type: "dashboard",
      id: "dash-1",
      __agentNativeSelectedObjectSource: "client-tab",
    };
    getCurrentRequestBrowserTabId.mockReturnValue(null);
    readAppState.mockImplementation(async (key: string) =>
      key === "selected-object:client-tab" ? current : null,
    );

    await expect(
      action.run({
        browserTabId: "client-tab",
        dashboardId: "dash-1",
        source: "client-tab",
      }),
    ).resolves.toEqual({ cleared: true });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object:client-tab",
      current,
      null,
    );
  });
});
