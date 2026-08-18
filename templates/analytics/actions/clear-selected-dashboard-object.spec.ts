import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

const readAppState = vi.fn();
const compareAndSetAppState = vi.fn();
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState,
  readAppState,
}));

const action = (await import("./clear-selected-dashboard-object.js")).default;

describe("clear-selected-dashboard-object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareAndSetAppState.mockResolvedValue(true);
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

  it("does not clear a selection owned by another tab", async () => {
    readAppState.mockResolvedValue({
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
    readAppState.mockResolvedValue({
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
    readAppState.mockResolvedValue(current);
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
    readAppState.mockResolvedValue(newerSelection);
    compareAndSetAppState.mockResolvedValue(false);

    await expect(
      action.run({
        expectedSelection: originalSelection,
        source: "test-tab",
      }),
    ).resolves.toEqual({ cleared: false });

    expect(compareAndSetAppState).toHaveBeenCalledWith(
      "selected-object",
      originalSelection,
      null,
    );
  });
});
