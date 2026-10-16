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
  settings: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/settings", () => {
  const mutate =
    (scope: string) =>
    async (
      id: string,
      key: string,
      update: (current: Record<string, unknown> | null) => any,
    ) => {
      const next = await update(
        mocks.settings.get(`${scope}:${id}:${key}`) ?? null,
      );
      mocks.settings.set(`${scope}:${id}:${key}`, next);
      return next;
    };
  return {
    getUserSetting: async (email: string, key: string) =>
      mocks.settings.get(`u:${email}:${key}`) ?? null,
    getOrgSetting: async (orgId: string, key: string) =>
      mocks.settings.get(`o:${orgId}:${key}`) ?? null,
    mutateUserSetting: mutate("u"),
    mutateOrgSetting: mutate("o"),
    putUserSetting: async () => undefined,
  };
});

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
  getDashboard: vi.fn(async () => null),
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
const { loadBuiltinDashboard } =
  await import("../server/lib/builtin-dashboards");
const ADMIN = { email: "admin@example.com", orgId: "org-builder" };

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
    mocks.settings.clear();
    mocks.requireAnalyticsAdminContext.mockClear();
    mocks.getDataProgram.mockImplementation(async (id: string) => program(id));
  });

  it("installs the read-only built-in for the org from real program bindings", async () => {
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
    expect(result.dashboards[0].dashboardId).toBe("builtin-customer-roi-v2");
    const builtin = await loadBuiltinDashboard("builtin-customer-roi-v2", {
      email: "someone-else@example.com",
      orgId: "org-builder",
    });
    const config = builtin!.config as any;
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
    expect(mocks.setResourceVisibility).not.toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: "dashboard" }),
    );
  });

  it("keeps the installed bindings on a repeat install", async () => {
    await ensureNativeV2Dashboards.run({
      templateIds: ["customer-roi-v2"],
      bindings: BINDINGS,
      overwrite: false,
    });

    const result = await ensureNativeV2Dashboards.run({
      templateIds: ["customer-roi-v2"],
      bindings: { ...BINDINGS, "roi.kpi": { programId: "dp-other" } },
      overwrite: false,
    });

    expect(result.dashboards[0].status).toBe("preserved");
    const builtin = await loadBuiltinDashboard(
      "builtin-customer-roi-v2",
      ADMIN,
    );
    expect(JSON.stringify(builtin!.config)).toContain("dp-roi-kpi");
    expect(JSON.stringify(builtin!.config)).not.toContain("dp-other");
  });

  it("rejects a program that has not produced the declared output contract", async () => {
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
    expect(mocks.settings.size).toBe(0);
  });

  it("shares private bindings when the explicit org provisioner receives them", async () => {
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

    expect(mocks.setResourceVisibility).toHaveBeenCalledTimes(3);
    expect(mocks.setResourceVisibility).toHaveBeenCalledWith({
      resourceType: "data_program",
      resourceId: "dp-roi-kpi",
      visibility: "org",
    });
  });
});
