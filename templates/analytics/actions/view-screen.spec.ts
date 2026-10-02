import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationState: { current: unknown } = { current: null };
const urlState: { current: unknown } = { current: null };
const selectedObjectState: { current: unknown } = { current: null };

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: vi.fn(async (key: string) => {
    if (key === "navigation") return navigationState.current;
    if (key === "__url__") return urlState.current;
    if (key === "selected-object") return selectedObjectState.current;
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

const getDashboard = vi.fn(async () => null);
const listSessionRecordingsPage = vi.fn(async () => ({
  recordings: [] as { id: string }[],
  total: 0,
  appCounts: [] as { app: string; count: number }[],
}));

vi.mock("../server/lib/analytics-alerts", () => ({
  listAnalyticsAlertRules: vi.fn(async () => []),
}));
vi.mock("../server/lib/dashboard-catalog", () => ({
  listDashboardCatalog: vi.fn(async () => []),
}));
vi.mock("../server/lib/dashboards-store", () => ({
  getAnalysis: vi.fn(async () => null),
  getDashboard,
}));
vi.mock("../server/lib/first-party-analytics.js", () => ({
  listAnalyticsPublicKeys: vi.fn(async () => []),
}));
vi.mock("../server/lib/session-replay.js", () => ({
  getSessionReplaySummary: vi.fn(async () => null),
  listSessionRecordings: vi.fn(async () => []),
  listSessionRecordingsPage,
  replayRangeToIso: vi.fn((range: string) =>
    range === "all" ? null : "2026-09-01T00:00:00.000Z",
  ),
}));

const getSessionFrictionDetails = vi.fn(
  async (_scope: unknown, recordings: Array<{ id: string }>) =>
    new Map(recordings.map((recording) => [recording.id, { score: 3 }])),
);
vi.mock("../server/lib/session-friction.js", () => ({
  getSessionFrictionDetails,
}));

const isSessionsTriageLabEnabled = vi.fn(async () => false);
vi.mock("../server/lib/sessions-triage-lab.js", () => ({
  isSessionsTriageLabEnabled,
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
    getDashboard.mockReset();
    getDashboard.mockResolvedValue(null);
    userEmail = "user@example.test";
    selectedObjectState.current = null;
  });

  it("does not surface a stale dashboard selection on Ask", async () => {
    selectedObjectState.current = {
      type: "dashboard",
      id: "dash-1",
      title: "Revenue",
    };
    setScreen({ view: "adhoc", dashboardId: "dash-1" }, { pathname: "/ask" });

    const out = await runScreen();

    expect(out.selectedObject).toBeUndefined();
    expect(out.navigation).toEqual({ view: "ask" });
    expect(out.dashboard).toBeUndefined();
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it("does not let stale Ask navigation mask a dashboard URL", async () => {
    selectedObjectState.current = {
      type: "dashboard",
      id: "dash-1",
      title: "Revenue",
    };
    setScreen({ view: "ask" }, { pathname: "/dashboards/dash-1" });

    const out = await runScreen();

    expect(out.pathname).toBe("/dashboards/dash-1");
    expect(out.navigation).toEqual({
      view: "adhoc",
      dashboardId: "dash-1",
    });
    expect(out.selectedObject).toEqual(selectedObjectState.current);
  });

  it("uses the dashboard URL when navigation names a different dashboard", async () => {
    setScreen(
      { view: "adhoc", dashboardId: "dash-1" },
      { pathname: "/dashboards/dash-2" },
    );

    const out = await runScreen();

    expect(out.navigation).toEqual({
      view: "adhoc",
      dashboardId: "dash-2",
    });
    expect(getDashboard).toHaveBeenCalledWith("dash-2", {
      email: "user@example.test",
      orgId: "org-1",
    });
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
    expect(out.page).toBe("monitoring");
  });
});

describe("view-screen Sessions context", () => {
  beforeEach(() => {
    userEmail = "user@example.test";
    selectedObjectState.current = null;
    listSessionRecordingsPage.mockReset();
    listSessionRecordingsPage.mockResolvedValue({
      recordings: Array.from({ length: 25 }, (_, index) => ({
        id: `recording-${index}`,
      })),
      total: 137,
      appCounts: [],
    });
  });

  it("uses default filters and labels the bounded first-page excerpt without a Lab marker", async () => {
    setScreen(
      { view: "sessions" },
      { pathname: "/sessions", searchParams: {} },
    );

    const out = await runScreen();

    expect(out.sessionReplayPage).toMatchObject({
      page: 1,
      pageSize: 100,
      offset: 0,
      total: 137,
      returnedCount: 25,
      excerptLimit: 25,
      truncated: true,
      filters: { range: "30d", hideEmpty: true, sort: "newest", offset: 0 },
      fullPageAction: {
        name: "list-session-recordings",
        args: { paginated: true, hideEmpty: true, offset: 0, limit: 100 },
      },
    });
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      expect.objectContaining({
        from: "2026-09-01T00:00:00.000Z",
        hideEmpty: true,
        sort: "newest",
        offset: 0,
        limit: 25,
      }),
    );
  });

  it("keeps the UI page offset, filters, and full-page retrieval scope", async () => {
    setScreen(
      { view: "sessions" },
      {
        pathname: "/sessions",
        searchParams: {
          range: "custom",
          from: "2026-09-01T00:00:00.000Z",
          to: "2026-09-04T23:59:59.999Z",
          app: "clips",
          visitorType: "work",
          emailDomain: "example.test",
          hasNetworkErrors: "true",
          sort: "errors",
          page: "2",
          minDurationMs: "300000",
        },
      },
    );

    const out = await runScreen();
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-04T23:59:59.999Z",
        app: "clips",
        visitorType: "work",
        emailDomain: "example.test",
        hasNetworkErrors: true,
        minDurationMs: 300000,
        hideEmpty: true,
        sort: "errors",
        offset: 100,
        limit: 25,
      }),
    );
    expect(out.sessionReplayPage).toMatchObject({
      page: 2,
      pageSize: 100,
      offset: 100,
      total: 137,
      returnedCount: 25,
      truncated: true,
      filters: { range: "custom", app: "clips", sort: "errors" },
      fullPageAction: {
        args: { paginated: true, offset: 100, limit: 100 },
      },
    });
  });

  it("uses date-only custom bounds for the same interval as the Sessions UI", async () => {
    setScreen(
      { view: "sessions" },
      {
        pathname: "/sessions",
        searchParams: {
          range: "custom",
          fromDate: "2026-09-23",
          toDate: "2026-09-25",
        },
      },
    );

    const out = await runScreen();
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: "2026-09-23T00:00:00.000Z",
        to: "2026-09-25T23:59:59.999Z",
      }),
    );
    expect(out.sessionReplayPage.fullPageAction.args).toMatchObject({
      from: "2026-09-23T00:00:00.000Z",
      to: "2026-09-25T23:59:59.999Z",
    });
  });

  it("preserves legacy includeZero and lets explicit hideEmpty win", async () => {
    setScreen(
      { view: "sessions" },
      {
        pathname: "/sessions",
        searchParams: { triage: "1", includeZeroMinuteSessions: "true" },
      },
    );
    const legacy = await runScreen();
    expect(legacy.sessionReplayPage.filters.hideEmpty).toBe(false);
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hideEmpty: false }),
    );

    setScreen(
      { view: "sessions" },
      {
        pathname: "/sessions",
        searchParams: {
          includeZeroMinuteSessions: "true",
          hideEmpty: "true",
        },
      },
    );
    const explicit = await runScreen();
    expect(explicit.sessionReplayPage.filters.hideEmpty).toBe(true);
  });

  it("reports a complete excerpt when fewer than 25 rows remain", async () => {
    listSessionRecordingsPage.mockResolvedValueOnce({
      recordings: [{ id: "recording-1" }],
      total: 101,
      appCounts: [],
    });
    setScreen(
      { view: "sessions" },
      { pathname: "/sessions", searchParams: { page: "2" } },
    );

    const out = await runScreen();
    expect(out.sessionReplayPage).toMatchObject({
      offset: 100,
      total: 101,
      returnedCount: 1,
      truncated: false,
    });
  });

  it("applies event conditions from the URL only while the Lab is on", async () => {
    const url = {
      pathname: "/sessions",
      search:
        "?event=recording_started&noEvent=clip_viewed&noEvent=clip_viewed",
      searchParams: { event: "recording_started", noEvent: "clip_viewed" },
    };
    isSessionsTriageLabEnabled.mockResolvedValueOnce(true);
    setScreen({ view: "sessions" }, url);

    const on = await runScreen();

    expect(listSessionRecordingsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        didEvents: ["recording_started"],
        didNotEvents: ["clip_viewed"],
      }),
    );
    expect(on.sessionReplayPage.fullPageAction.args).toMatchObject({
      didEvents: ["recording_started"],
      didNotEvents: ["clip_viewed"],
    });
    expect(on.sessionReplayPage.eventConditionsNotApplied).toBeUndefined();

    isSessionsTriageLabEnabled.mockResolvedValueOnce(false);
    const off = await runScreen();

    expect(listSessionRecordingsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.not.objectContaining({ didEvents: expect.anything() }),
    );
    expect(off.sessionReplayPage.eventConditionsNotApplied).toEqual({
      didEvents: ["recording_started"],
      didNotEvents: ["clip_viewed"],
    });
  });

  it("applies friction filters, sorts, and row friction only while the Lab is on", async () => {
    const url = {
      pathname: "/sessions",
      search: "?signal=dead_clicks&signal=nope&sort=friction",
      searchParams: { signal: "dead_clicks", sort: "friction" },
    };
    isSessionsTriageLabEnabled.mockResolvedValueOnce(true);
    setScreen({ view: "sessions" }, url);

    const on = await runScreen();

    expect(listSessionRecordingsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        frictionSignals: ["dead_clicks"],
        sort: "friction",
      }),
    );
    expect(on.sessionReplays[0]).toEqual({
      id: "recording-0",
      friction: { score: 3 },
    });
    expect(on.sessionReplayPage.fullPageAction.args).toMatchObject({
      frictionSignals: ["dead_clicks"],
      sort: "friction",
      includeFriction: true,
    });
    expect(on.sessionReplayPage.frictionNotApplied).toBeUndefined();

    getSessionFrictionDetails.mockClear();
    isSessionsTriageLabEnabled.mockResolvedValueOnce(false);
    const off = await runScreen();

    expect(listSessionRecordingsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ sort: "newest" }),
    );
    expect(listSessionRecordingsPage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.not.objectContaining({ frictionSignals: expect.anything() }),
    );
    expect(getSessionFrictionDetails).not.toHaveBeenCalled();
    expect(off.sessionReplays[0]).toEqual({ id: "recording-0" });
    expect(off.sessionReplayPage.fullPageAction.args).not.toHaveProperty(
      "includeFriction",
    );
    expect(off.sessionReplayPage.frictionNotApplied).toEqual({
      signals: ["dead_clicks"],
      sort: "friction",
    });
  });

  it("keeps an unsafe page out of the backend offset and context", async () => {
    setScreen(
      { view: "sessions" },
      {
        pathname: "/sessions",
        searchParams: { page: "9007199254740993" },
      },
    );

    const out = await runScreen();
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ offset: 0, limit: 25 }),
    );
    expect(out.sessionReplayPage).toMatchObject({ page: 1, offset: 0 });
  });
});

describe("view-screen event catalog", () => {
  beforeEach(() => {
    userEmail = "user@example.test";
    selectedObjectState.current = null;
    isSessionsTriageLabEnabled.mockReset();
  });

  it("points the agent at the catalog action for the visible range and app", async () => {
    isSessionsTriageLabEnabled.mockResolvedValue(true);
    setScreen(
      { view: "event-catalog" },
      {
        pathname: "/sessions/events",
        searchParams: { range: "7d", app: "clips" },
      },
    );

    const out = await runScreen();

    expect(out.page).toBe("event-catalog");
    expect(out.eventCatalog).toEqual({
      range: "7d",
      app: "clips",
      fullPageAction: {
        name: "list-event-catalog",
        args: { from: "2026-09-01T00:00:00.000Z", app: "clips" },
      },
    });
    expect(isSessionsTriageLabEnabled).toHaveBeenCalledWith(
      "user@example.test",
      "org-1",
    );
  });

  it("reports the Lab as off instead of describing the catalog", async () => {
    isSessionsTriageLabEnabled.mockResolvedValue(false);
    setScreen(
      { view: "event-catalog" },
      { pathname: "/sessions/events", searchParams: {} },
    );

    const out = await runScreen();

    expect(out.page).toBe("event-catalog");
    expect(out.eventCatalog).toEqual({ labEnabled: false });
  });
});
