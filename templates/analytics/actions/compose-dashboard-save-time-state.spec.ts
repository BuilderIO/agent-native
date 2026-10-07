import { beforeEach, describe, expect, it, vi } from "vitest";

import { sameJsonValue } from "./dashboard-mutation-api";

const store = new Map<string, { config: Record<string, unknown> }>();

const mocks = vi.hoisted(() => ({
  assertDashboardEditable: vi.fn(async (): Promise<void> => undefined),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  upsertDashboardWithRetryOutcome: vi.fn(),
  resolvePanel: vi.fn(),
  queueSync: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  embedApp: vi.fn((value: unknown) => value),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  buildDeepLink: () => "/analytics/adhoc",
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getCredentialContext: () => ({
      userEmail: "alice@example.com",
      orgId: null,
    }),
  }),
);
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  track: mocks.track,
}));
vi.mock("../server/lib/dashboard-collab-sync", () => ({
  queueDashboardCollabSync: mocks.queueSync,
}));
vi.mock("../server/lib/dashboards-store", () => ({
  assertDashboardEditable: mocks.assertDashboardEditable,
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
  upsertDashboardWithRetryOutcome: mocks.upsertDashboardWithRetryOutcome,
}));
vi.mock("../server/lib/dashboard-panel-source-resolver", () => ({
  resolveAnalyticsPanelSource: mocks.resolvePanel,
}));
vi.mock("../server/lib/first-party-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/first-party-analytics.js")
  >()),
  validateFirstPartyAnalyticsSqlForScope: vi.fn(async () => undefined),
}));

const { default: composeDashboard } = await import("./compose-dashboard");
const { buildPanel } = await import("../server/lib/first-party-metric-catalog");

const agent = { userEmail: "alice@example.com", orgId: null, caller: "tool" };
const ROWS = [
  { date: "2026-09-01", template: "mail", count: 3 },
  { date: "2026-09-01", template: "clips", count: 4 },
];
const SECTION = {
  id: "overview",
  title: "Overview",
  chartType: "section",
  width: 6,
};

function result(rows: Record<string, unknown>[]) {
  return {
    rows,
    schema: Object.keys(rows[0] ?? {}).map((name) => ({
      name,
      type: "STRING",
    })),
  };
}

const panelIds = (id = "growth") =>
  (store.get(id)!.config.panels as Array<{ id: string }>).map((p) => p.id);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mocks.assertDashboardEditable.mockResolvedValue(undefined);
  mocks.resolvePanel.mockResolvedValue(result(ROWS));
  mocks.getDashboard.mockImplementation(async (id: string) => {
    const saved = store.get(id);
    return saved ? { kind: "sql", config: saved.config } : null;
  });
  mocks.upsertDashboard.mockImplementation(
    async (id: string, _kind: string, config: Record<string, unknown>) => {
      store.set(id, { config });
      return { id, title: id, archivedAt: null };
    },
  );
  mocks.upsertDashboardWithRetryOutcome.mockImplementation(
    async (id: string, ctx: unknown, mutate: any) => {
      const existing = await mocks.getDashboard(id, ctx);
      const { kind, body } = await mutate(existing);
      const didWrite = !sameJsonValue(existing.config, body);
      await mocks.upsertDashboard(id, kind, body, ctx);
      return { dashboard: { ...existing, kind, config: body }, didWrite };
    },
  );
});

describe("compose-dashboard against the dashboard as it is when the save happens", () => {
  describe("a dashboard another call creates while this one verifies", () => {
    const createdMidCall = () =>
      mocks.resolvePanel.mockImplementationOnce(async () => {
        store.set("growth", { config: { name: "Growth", panels: [SECTION] } });
        return result(ROWS);
      });

    it("appends to it by default instead of replacing the first call's panels", async () => {
      createdMidCall();

      const composed: any = await composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      );

      expect(panelIds()).toEqual(["overview", "signups-over-time"]);
      expect(composed).toMatchObject({
        saved: true,
        changed: true,
        verified: true,
        panelCount: 2,
      });
      expect(composed.message).toContain('Appended 1 panel(s) to "growth"');
    });

    it("still replaces it when the caller asked to overwrite", async () => {
      createdMidCall();

      await composeDashboard.run(
        {
          dashboardId: "growth",
          metrics: ["signups-over-time"],
          overwrite: true,
        },
        agent,
      );

      expect(panelIds()).toEqual(["signups-over-time"]);
    });

    it("checks edit permission on the dashboard it found before merging into it", async () => {
      createdMidCall();
      mocks.assertDashboardEditable.mockRejectedValue(
        Object.assign(new Error("Requires editor role (have viewer)"), {
          statusCode: 403,
        }),
      );

      await expect(
        composeDashboard.run(
          { dashboardId: "growth", metrics: ["signups-over-time"] },
          agent,
        ),
      ).rejects.toMatchObject({ errorCode: "dashboard_forbidden" });
      expect(panelIds()).toEqual(["overview"]);
    });
  });

  describe("what counts as a change", () => {
    it("reports the default filters it adds when every requested panel is already there", async () => {
      store.set("growth", {
        config: { name: "Growth", panels: [buildPanel("signups-over-time")!] },
      });

      const composed: any = await composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      );

      expect(store.get("growth")!.config.filters).toEqual([
        expect.objectContaining({ id: "timeRange" }),
        expect.objectContaining({ id: "emailFilter" }),
        expect.objectContaining({ id: "appFilter" }),
      ]);
      expect(composed).toMatchObject({
        changed: true,
        skippedExistingIds: ["signups-over-time"],
        _receipt: { changed: true, subject: "growth" },
      });
      expect(mocks.queueSync).toHaveBeenCalledOnce();
      expect(mocks.track).toHaveBeenCalledOnce();
    });

    it("treats an overwrite that matches the stored config as a no-op", async () => {
      await composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      );
      mocks.queueSync.mockClear();
      mocks.track.mockClear();

      const again: any = await composeDashboard.run(
        {
          dashboardId: "growth",
          metrics: ["signups-over-time"],
          overwrite: true,
        },
        agent,
      );

      expect(again.changed).toBe(false);
      expect(again._receipt).toBeUndefined();
      expect(again.message).toContain('No changes were needed for "growth"');
      expect(mocks.queueSync).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });

    it("still reports an overwrite that changes the config", async () => {
      await composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      );

      const again: any = await composeDashboard.run(
        {
          dashboardId: "growth",
          metrics: ["signups-by-template"],
          overwrite: true,
        },
        agent,
      );

      expect(panelIds()).toEqual(["signups-by-template"]);
      expect(again).toMatchObject({
        changed: true,
        _receipt: { changed: true },
      });
      expect(again.message).toContain('Replaced "growth"');
    });

    it("treats refreshing a panel with identical content as a no-op", async () => {
      await composeDashboard.run(
        { dashboardId: "growth", metrics: ["signups-over-time"] },
        agent,
      );
      mocks.queueSync.mockClear();
      mocks.track.mockClear();

      const again: any = await composeDashboard.run(
        {
          dashboardId: "growth",
          metrics: ["signups-over-time"],
          refreshExisting: true,
        },
        agent,
      );

      expect(again.refreshedExistingIds).toEqual(["signups-over-time"]);
      expect(again.changed).toBe(false);
      expect(again._receipt).toBeUndefined();
      expect(mocks.queueSync).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    });
  });
});
