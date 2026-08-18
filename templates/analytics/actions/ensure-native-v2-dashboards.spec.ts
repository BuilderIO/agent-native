import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAnalyticsAdminContext: vi.fn(async () => ({
    userEmail: "admin@example.com",
    orgId: "org-builder",
    role: "admin" as const,
  })),
  getDataProgram: vi.fn(),
  resolveAccess: vi.fn(async () => ({ role: "owner" })),
  setResourceVisibility: vi.fn(async () => ({ ok: true, visibility: "org" })),
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({
    id: "native-customer-roi-v2-abc",
    visibility: "private",
  })),
}));

vi.mock("../server/lib/db-admin-connections", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

vi.mock("@agent-native/core/data-programs", () => ({
  getDataProgram: mocks.getDataProgram,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("@agent-native/core/sharing/actions/set-resource-visibility", () => ({
  default: { run: mocks.setResourceVisibility },
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(({ params }: { params?: { dashboardId?: string } }) =>
    params?.dashboardId
      ? `/analytics/adhoc/${params.dashboardId}`
      : "/analytics/adhoc",
  ),
  getRequestOrgId: () => "org-builder",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

const { default: ensureNativeV2Dashboards } =
  await import("./ensure-native-v2-dashboards");

const BINDINGS = {
  "roi.kpi": { programId: "dp-roi-kpi" },
  "roi.trend": { programId: "dp-roi-trend" },
  "roi.detail": { programId: "dp-roi-detail" },
};

function program(id: string) {
  return {
    id,
    orgId: "org-builder",
    visibility: "org",
    archivedAt: null,
    outputColumns: JSON.stringify([
      { name: "value", type: "number" },
      { name: "period", type: "string" },
      { name: "account", type: "string" },
      { name: "investment", type: "number" },
      { name: "roi", type: "number" },
      { name: "matched_by", type: "string" },
      { name: "match_quality", type: "string" },
    ]),
  };
}

describe("ensure-native-v2-dashboards", () => {
  beforeEach(() => {
    mocks.getDataProgram.mockReset();
    mocks.resolveAccess.mockClear();
    mocks.setResourceVisibility.mockClear();
    mocks.getDashboard.mockReset();
    mocks.upsertDashboard.mockClear();
    mocks.requireAnalyticsAdminContext.mockClear();
    mocks.getDataProgram.mockImplementation(async (id: string) => program(id));
  });

  it("creates a deterministic org-scoped v2 copy from real program bindings", async () => {
    mocks.getDashboard.mockResolvedValue(null);

    const result = await ensureNativeV2Dashboards.run({
      templateIds: ["customer-roi-v2"],
      bindings: BINDINGS,
      overwrite: false,
    });

    expect(result.orgId).toBe("org-builder");
    expect(result.dashboards[0]).toMatchObject({
      templateId: "customer-roi-v2",
      status: "created",
    });
    expect(result.dashboards[0].dashboardId).toMatch(
      /^native-customer-roi-v2-[a-f0-9]{10}$/,
    );
    expect(mocks.upsertDashboard).toHaveBeenCalledTimes(1);
    const config = mocks.upsertDashboard.mock.calls[0][2];
    expect(config.catalog.templateId).toBe("customer-roi-v2");
    expect(
      config.panels.find((panel: any) => panel.id === "roi-kpi"),
    ).toMatchObject({
      source: "program",
      chartType: "metric",
    });
    expect(JSON.parse(config.panels[1].sql)).toEqual({
      programId: "dp-roi-kpi",
    });
    expect(mocks.setResourceVisibility).toHaveBeenCalledWith({
      resourceType: "dashboard",
      resourceId: result.dashboards[0].dashboardId,
      visibility: "org",
    });
  });

  it("preserves existing v2 edits on a repeat install", async () => {
    mocks.getDashboard.mockResolvedValue({
      config: {
        catalog: { templateId: "customer-roi-v2" },
        panels: [{ id: "human-edit" }],
      },
    });

    const result = await ensureNativeV2Dashboards.run({
      templateIds: ["customer-roi-v2"],
      bindings: BINDINGS,
      overwrite: false,
    });

    expect(result.dashboards[0].status).toBe("preserved");
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("rejects a program that has not produced the declared output contract", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    mocks.getDataProgram.mockImplementation(async (id: string) => ({
      ...program(id),
      outputColumns: JSON.stringify([{ name: "value", type: "number" }]),
    }));

    await expect(
      ensureNativeV2Dashboards.run({
        templateIds: ["customer-roi-v2"],
        bindings: BINDINGS,
        overwrite: false,
      }),
    ).rejects.toThrow(/missing required output columns/);
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });

  it("shares private bindings when the explicit org provisioner receives them", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    mocks.getDataProgram.mockImplementation(async (id: string) => ({
      ...program(id),
      visibility: "private",
      orgId: null,
    }));

    await ensureNativeV2Dashboards.run({
      templateIds: ["customer-roi-v2"],
      bindings: BINDINGS,
      overwrite: false,
    });

    expect(mocks.setResourceVisibility).toHaveBeenCalledTimes(4);
    expect(mocks.setResourceVisibility).toHaveBeenCalledWith({
      resourceType: "data_program",
      resourceId: "dp-roi-kpi",
      visibility: "org",
    });
  });
});
