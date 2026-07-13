import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppStateForCurrentTab = vi.fn(async () => {});
const listDashboardSummaries = vi.fn(async () => [] as any[]);

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "person@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("../server/lib/dashboards-store", () => ({
  listDashboardSummaries,
}));

const { default: navigateAction } = await import("./navigate");

describe("navigate action", () => {
  beforeEach(() => {
    writeAppStateForCurrentTab.mockClear();
    listDashboardSummaries.mockReset();
    listDashboardSummaries.mockResolvedValue([]);
  });

  it('resolves "Take me to my Agent Native dashboard" by accessible name', async () => {
    listDashboardSummaries.mockResolvedValue([
      {
        id: "dashboard-agent-native",
        name: "Agent Native",
        ownerEmail: "person@example.com",
      },
    ]);

    await navigateAction.run({
      dashboardName: "Agent Native dashboard",
    } as never);

    expect(listDashboardSummaries).toHaveBeenCalledWith(
      { email: "person@example.com", orgId: "org-1" },
      { kind: "sql", archived: "active", hidden: "visible" },
    );
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "adhoc",
      dashboardId: "dashboard-agent-native",
    });
  });

  it("fails clearly when an accessible dashboard name is unknown", async () => {
    await expect(
      navigateAction.run({ dashboardName: "Missing dashboard" } as never),
    ).rejects.toThrow('No accessible dashboard named "Missing dashboard"');
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("does not guess when an accessible dashboard name is ambiguous", async () => {
    listDashboardSummaries.mockResolvedValue([
      { id: "dashboard-1", name: "Revenue", ownerEmail: "one@example.com" },
      { id: "dashboard-2", name: "Revenue", ownerEmail: "two@example.com" },
    ]);

    await expect(
      navigateAction.run({ dashboardName: "Revenue" } as never),
    ).rejects.toThrow("More than one accessible dashboard");
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
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
