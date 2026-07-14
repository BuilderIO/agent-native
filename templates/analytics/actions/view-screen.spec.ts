import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState: { current: unknown } = { current: null };
const urlState: { current: unknown } = { current: null };

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn(async (key: string) => {
    if (key === "navigation") return navigationState.current;
    if (key === "__url__") return urlState.current;
    return null;
  }),
}));

let userEmail: string | null = "user@example.test";
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => userEmail,
  getRequestOrgId: () => "org-1",
}));

const listStatusPages = vi.fn();
const getStatusPagePreview = vi.fn();
vi.mock("../server/lib/status-pages.js", () => ({
  listStatusPages,
  getStatusPagePreview,
}));

const getMonitor = vi.fn();
const listMonitors = vi.fn(async () => []);
vi.mock("../server/lib/uptime-monitors.js", () => ({
  getMonitor,
  listMonitors,
}));

const getErrorIssue = vi.fn();
const listErrorIssues = vi.fn(async () => []);
vi.mock("../server/lib/error-capture.js", () => ({
  getErrorIssue,
  listErrorIssues,
}));

// The remaining server libs are imported at module load but never exercised by
// the monitoring branch under test - stub them so the action loads in isolation.
vi.mock("../server/lib/analytics-alerts", () => ({
  listAnalyticsAlertRules: vi.fn(async () => []),
}));
vi.mock("../server/lib/dashboard-catalog", () => ({
  listDashboardCatalog: vi.fn(async () => []),
}));
vi.mock("../server/lib/dashboards-store", () => ({
  getAnalysis: vi.fn(async () => null),
  getDashboard: vi.fn(async () => null),
}));
vi.mock("../server/lib/first-party-analytics.js", () => ({
  listAnalyticsPublicKeys: vi.fn(async () => []),
}));
vi.mock("../server/lib/session-replay.js", () => ({
  getSessionReplaySummary: vi.fn(async () => null),
  listSessionRecordings: vi.fn(async () => []),
  replayRangeToIso: vi.fn(() => null),
}));

const { default: viewScreenAction } = await import("./view-screen");

function setScreen(
  navigation: Record<string, unknown>,
  url: unknown = { pathname: "/monitoring" },
) {
  navigationState.current = navigation;
  urlState.current = url;
}

async function runScreen(): Promise<Record<string, any>> {
  return JSON.parse(await viewScreenAction.run({} as never));
}

describe("view-screen monitoring status-pages branch", () => {
  beforeEach(() => {
    listStatusPages.mockReset();
    getStatusPagePreview.mockReset();
    listMonitors.mockClear();
    userEmail = "user@example.test";
  });

  it("lists status pages in the monitoring surfaces catalog", async () => {
    setScreen({ view: "monitoring", monitoringView: "uptime" });
    const out = await runScreen();
    expect(out.page).toBe("monitoring");
    const ids = out.monitoringSurfaces.map((surface: any) => surface.id);
    expect(ids).toEqual(["uptime", "status-pages", "errors"]);
  });

  it("reports the status-pages index scoped to the owner", async () => {
    listStatusPages.mockResolvedValue([
      {
        id: "sp-1",
        slug: "acme",
        title: "Acme",
        published: true,
        monitors: [{ monitorId: "m1" }, { monitorId: "m2" }],
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);
    setScreen({
      view: "monitoring",
      monitoringView: "uptime",
      statusPageId: "list",
    });
    const out = await runScreen();
    expect(listStatusPages).toHaveBeenCalledWith({
      email: "user@example.test",
      orgId: "org-1",
    });
    expect(out.uptimeSubview).toBe("status-pages");
    expect(out.statusPages).toHaveLength(1);
    expect(out.statusPages[0]).toMatchObject({
      id: "sp-1",
      slug: "acme",
      monitorCount: 2,
      publicUrl: "/status/acme",
    });
    // The uptime monitors list must not leak into the status-pages sub-view.
    expect(listMonitors).not.toHaveBeenCalled();
  });

  it("reports create mode for a new status page", async () => {
    setScreen({
      view: "monitoring",
      monitoringView: "uptime",
      statusPageId: "new",
    });
    const out = await runScreen();
    expect(out.statusPageMode).toBe("create");
    expect(getStatusPagePreview).not.toHaveBeenCalled();
  });

  it("reports rich detail for a selected status page", async () => {
    getStatusPagePreview.mockResolvedValue({
      page: {
        id: "sp-1",
        slug: "acme",
        title: "Acme Status",
        description: "All systems",
        published: false,
        showUptimeBars: true,
        showOverallUptime: true,
        showResponseTime: false,
        density: "comfortable",
        alignment: "left",
        monitors: [{ monitorId: "m1" }],
        updatedAt: "2026-07-01T00:00:00Z",
      },
      view: {
        overall: "operational",
        counts: { up: 1, down: 0, degraded: 0, total: 1 },
        monitors: [
          {
            id: "m1",
            name: "API",
            host: "api.acme.io",
            status: "up",
            windows: { uptime24h: 99.9, uptime7d: 99.5 },
          },
        ],
      },
    });
    setScreen({
      view: "monitoring",
      monitoringView: "uptime",
      statusPageId: "sp-1",
    });
    const out = await runScreen();
    expect(getStatusPagePreview).toHaveBeenCalledWith("sp-1", {
      email: "user@example.test",
      orgId: "org-1",
    });
    expect(out.statusPage).toMatchObject({
      id: "sp-1",
      slug: "acme",
      published: false,
      publicUrl: "/status/acme",
      monitorCount: 1,
      overall: "operational",
      counts: { up: 1, total: 1 },
    });
    expect(out.statusPage.includedMonitors[0]).toMatchObject({
      id: "m1",
      name: "API",
      host: "api.acme.io",
      status: "up",
      uptime24h: 99.9,
    });
  });

  it("does not read status pages without an authenticated user", async () => {
    userEmail = null;
    setScreen({
      view: "monitoring",
      monitoringView: "uptime",
      statusPageId: "list",
    });
    const out = await runScreen();
    expect(listStatusPages).not.toHaveBeenCalled();
    // The surfaces catalog is still reported so the agent knows the sub-views.
    expect(out.page).toBe("monitoring");
  });
});
