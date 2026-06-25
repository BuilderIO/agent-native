import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  loadDashboardSeed: vi.fn(),
}));

vi.mock("@agent-native/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core")>();
  return {
    ...actual,
    embedApp: vi.fn((value: unknown) => value),
  };
});

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(
    ({
      app,
      view,
      params,
    }: {
      app: string;
      view: string;
      params?: { dashboardId?: string };
    }) => {
      const suffix = params?.dashboardId ? `/${params.dashboardId}` : "";
      return `/${app}/${view}${suffix}`;
    },
  ),
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
}));

vi.mock("../server/lib/dashboard-seeds", () => ({
  loadDashboardSeed: mocks.loadDashboardSeed,
}));

const { default: getSqlDashboard } = await import("./get-sql-dashboard");

describe("get-sql-dashboard seed fallback", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset();
    mocks.loadDashboardSeed.mockReset();
  });

  it("returns a seed when no SQL dashboard row exists", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    mocks.loadDashboardSeed.mockReturnValue({
      name: "Seed",
      panels: [{ id: "seed-panel" }],
    });

    const result = (await getSqlDashboard.run({ id: "seeded" })) as {
      panels: Array<{ id: string }>;
      ownerEmail: string | null;
      visibility: string;
    };

    expect(result.panels.map((panel) => panel.id)).toEqual(["seed-panel"]);
    expect(result.ownerEmail).toBeNull();
    expect(result.visibility).toBe("org");
  });

  it("returns a saved empty dashboard instead of rehydrating its seed", async () => {
    mocks.getDashboard.mockResolvedValue({
      kind: "sql",
      config: { name: "Blank", panels: [] },
      ownerEmail: "alice@example.com",
      orgId: null,
      visibility: "private",
      role: "owner",
      canEdit: true,
      canManage: true,
      archivedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    mocks.loadDashboardSeed.mockReturnValue({
      name: "Seed",
      panels: [{ id: "seed-panel" }],
    });

    const result = (await getSqlDashboard.run({ id: "seeded" })) as {
      panels: Array<{ id: string }>;
      name: string;
      ownerEmail: string | null;
    };

    expect(result.name).toBe("Blank");
    expect(result.panels).toEqual([]);
    expect(result.ownerEmail).toBe("alice@example.com");
  });
});
