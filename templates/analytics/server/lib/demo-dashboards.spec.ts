import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, Record<string, unknown>>();
  const dashboards = new Map<string, any>();
  const keyFor = (
    email: string,
    orgId: string | null | undefined,
    dashboardId: string,
  ) => `${email}:${orgId ?? ""}:${dashboardId}`;

  return {
    settings,
    dashboards,
    keyFor,
    getUserSetting: vi.fn(async (email: string, key: string) => {
      return settings.get(`${email}:${key}`) ?? null;
    }),
    putUserSetting: vi.fn(
      async (email: string, key: string, value: Record<string, unknown>) => {
        settings.set(`${email}:${key}`, value);
      },
    ),
    loadDashboardSeed: vi.fn((seedId: string) => ({
      name: seedId === "node-exporter-full" ? "Node Exporter Full" : seedId,
      filters: [
        { id: "range", type: "select", default: "6h" },
        { id: "job", type: "text", default: "node" },
        { id: "instance", type: "text", default: "127.0.0.1:9100" },
      ],
      panels: [
        {
          id: "demo-panel",
          title: "Demo panel",
          source: "prometheus",
          sql: JSON.stringify({
            promql: "up",
            mode: "instant",
          }),
          chartType: "metric",
          width: 1,
        },
      ],
    })),
    getDashboard: vi.fn(
      async (
        dashboardId: string,
        ctx: { email: string; orgId: string | null },
      ) => dashboards.get(keyFor(ctx.email, ctx.orgId, dashboardId)) ?? null,
    ),
    upsertDashboard: vi.fn(
      async (
        dashboardId: string,
        kind: string,
        config: Record<string, unknown>,
        ctx: { email: string; orgId: string | null },
      ) => {
        const row = {
          id: dashboardId,
          kind,
          title: String(config.name ?? dashboardId),
          config,
          archivedAt: null,
          orgId: ctx.orgId,
          ownerEmail: ctx.email,
        };
        dashboards.set(keyFor(ctx.email, ctx.orgId, dashboardId), row);
        return row;
      },
    ),
    hasCollabState: vi.fn(async () => false),
    applyText: vi.fn(async () => undefined),
    seedFromText: vi.fn(async () => undefined),
  };
});

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("./dashboard-seeds", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

vi.mock("./dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));

const {
  DEMO_DASHBOARD_VERSION,
  DEMO_DASHBOARD_STATE_KEY,
  DEMO_NODE_EXPORTER_DEFAULT_TAB,
  DEMO_NODE_EXPORTER_INSTANCE,
  DEMO_NODE_EXPORTER_JOB,
  demoNodeExporterConfig,
  ensureDemoDashboardsForUser,
  isDemoDashboardDeleted,
  markDemoDashboardDeleted,
} = await import("./demo-dashboards");
const { BUILTIN_DEMO_DASHBOARD_ID } =
  await import("../../shared/builtin-dashboard-ids");

const alice = { email: "alice@example.com", orgId: "org-1" };

describe("demo dashboards", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.dashboards.clear();
    mocks.getUserSetting.mockClear();
    mocks.putUserSetting.mockClear();
    mocks.loadDashboardSeed.mockClear();
    mocks.getDashboard.mockClear();
    mocks.upsertDashboard.mockClear();
    mocks.hasCollabState.mockClear();
    mocks.applyText.mockClear();
    mocks.seedFromText.mockClear();
    mocks.hasCollabState.mockResolvedValue(false);
    mocks.applyText.mockResolvedValue(undefined);
    mocks.seedFromText.mockResolvedValue(undefined);
  });

  it("serves the built-in Node Exporter demo without writing a dashboard", async () => {
    const result = await ensureDemoDashboardsForUser(alice);

    expect(result.defaultDashboardId).toBe(BUILTIN_DEMO_DASHBOARD_ID);
    const params = new URLSearchParams({
      tab: DEMO_NODE_EXPORTER_DEFAULT_TAB,
    });
    expect(result.defaultDashboardPath).toBe(
      `/dashboards/${BUILTIN_DEMO_DASHBOARD_ID}?${params.toString()}`,
    );
    expect(result.dashboards).toEqual([
      expect.objectContaining({ installed: true, created: false }),
    ]);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("builds the demo from the Node Exporter seed against the demo endpoint", () => {
    const config = demoNodeExporterConfig();

    expect(mocks.loadDashboardSeed).toHaveBeenCalledWith("node-exporter-full");
    expect(config).toEqual(
      expect.objectContaining({
        name: "Demo Node Exporter Full",
        demo: { id: "demo-node-exporter", version: DEMO_DASHBOARD_VERSION },
        catalog: {
          templateId: "demo-node-exporter",
          templateVersion: DEMO_DASHBOARD_VERSION,
        },
        filters: expect.arrayContaining([
          expect.objectContaining({
            id: "job",
            default: DEMO_NODE_EXPORTER_JOB,
          }),
          expect.objectContaining({
            id: "instance",
            default: DEMO_NODE_EXPORTER_INSTANCE,
          }),
        ]),
        panels: [
          expect.objectContaining({
            id: "demo-panel",
            source: "demo",
            sql: JSON.stringify({ promql: "up", mode: "instant" }),
          }),
        ],
      }),
    );
  });

  it("is idempotent after the first install", async () => {
    await ensureDemoDashboardsForUser(alice);
    await ensureDemoDashboardsForUser(alice);

    expect(mocks.putUserSetting).toHaveBeenCalledTimes(1);
  });

  it("tombstones deleted demos and does not recreate them", async () => {
    const first = await ensureDemoDashboardsForUser(alice);

    await markDemoDashboardDeleted(first.defaultDashboardId!, alice);
    const second = await ensureDemoDashboardsForUser(alice);

    expect(await isDemoDashboardDeleted(alice.email)).toBe(true);
    expect(second.dashboards[0]).toEqual(
      expect.objectContaining({
        id: "demo-node-exporter",
        dashboardId: first.defaultDashboardId,
        installed: false,
        deleted: true,
      }),
    );
    expect(second.defaultDashboardId).toBeNull();
    expect(second.defaultDashboardPath).toBeNull();

    const state = mocks.settings.get(
      `${alice.email}:${DEMO_DASHBOARD_STATE_KEY}`,
    )!;
    expect(state.deleted).toEqual(
      expect.objectContaining({ "demo-node-exporter": expect.any(String) }),
    );
  });

  it("reset restores tombstoned demos with the same dashboard IDs", async () => {
    const first = await ensureDemoDashboardsForUser(alice);
    await markDemoDashboardDeleted(first.defaultDashboardId!, alice);

    const reset = await ensureDemoDashboardsForUser(alice, { reset: true });

    expect(reset.reset).toBe(true);
    expect(reset.dashboards[0]).toEqual(
      expect.objectContaining({
        id: "demo-node-exporter",
        dashboardId: first.defaultDashboardId,
        installed: true,
        deleted: false,
      }),
    );
    expect(reset.defaultDashboardId).toBe(first.defaultDashboardId);

    const state = mocks.settings.get(
      `${alice.email}:${DEMO_DASHBOARD_STATE_KEY}`,
    )!;
    expect(state.deleted).toEqual({});
  });
});
