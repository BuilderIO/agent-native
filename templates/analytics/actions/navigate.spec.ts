import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppStateForCurrentTab = vi.fn(async () => {});

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab,
}));

const { default: navigateAction } = await import("./navigate");

describe("navigate monitoring targets", () => {
  beforeEach(() => {
    writeAppStateForCurrentTab.mockClear();
  });

  it("routes a monitoring subview to the monitoring tab", async () => {
    await navigateAction.run({ monitoringView: "errors" } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      monitoringView: "errors",
    });
  });

  it("opens a monitor under the uptime subview", async () => {
    await navigateAction.run({ monitorId: "mon-1" } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      monitorId: "mon-1",
      monitoringView: "uptime",
    });
  });

  it("opens an error issue under the errors subview", async () => {
    await navigateAction.run({ errorIssueId: "iss-1" } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      errorIssueId: "iss-1",
      monitoringView: "errors",
    });
  });

  it("opens the status-pages index under the uptime subview", async () => {
    await navigateAction.run({ statusPageId: "list" } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      statusPageId: "list",
      monitoringView: "uptime",
    });
  });

  it("opens the create-status-page form", async () => {
    await navigateAction.run({ statusPageId: "new" } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      statusPageId: "new",
      monitoringView: "uptime",
    });
  });

  it("opens a specific status page and echoes it in the result", async () => {
    const result = await navigateAction.run({
      statusPageId: "sp-1",
    } as never);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "monitoring",
      statusPageId: "sp-1",
      monitoringView: "uptime",
    });
    expect(result).toContain("status-page:sp-1");
  });

  it("requires at least one navigation target", async () => {
    await expect(navigateAction.run({} as never)).rejects.toThrow(/At least/);
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
