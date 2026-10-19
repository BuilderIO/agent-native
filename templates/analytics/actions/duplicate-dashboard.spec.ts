import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  listDashboardSummaries: vi.fn(),
  upsertDashboard: vi.fn(),
  loadBuiltinDashboard: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/analytics/adhoc"),
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("../server/lib/dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  listDashboardSummaries: mocks.listDashboardSummaries,
  normalizeDashboardName: (name: string) => name.trim().toLowerCase(),
  upsertDashboard: mocks.upsertDashboard,
}));

vi.mock("../server/lib/builtin-dashboards", () => ({
  loadBuiltinDashboard: mocks.loadBuiltinDashboard,
}));

const { default: duplicateDashboard } = await import("./duplicate-dashboard");

const BUILTIN = {
  id: "builtin-demo-node-exporter",
  version: "abc123",
  title: "Demo Node Exporter Full",
  config: {
    name: "Demo Node Exporter Full",
    demo: { id: "demo-node-exporter", version: "v1" },
    catalog: { templateId: "demo-node-exporter", templateVersion: "v1" },
    panels: [{ id: "cpu", source: "demo" }],
  },
};

describe("duplicate-dashboard", () => {
  beforeEach(() => {
    mocks.getDashboard.mockReset().mockResolvedValue(null);
    mocks.listDashboardSummaries.mockReset().mockResolvedValue([]);
    mocks.loadBuiltinDashboard.mockReset().mockResolvedValue(BUILTIN);
    mocks.upsertDashboard
      .mockReset()
      .mockImplementation(async (id: string, _kind: string, body: any) => ({
        id,
        title: body.name,
      }));
  });

  it("copies a built-in into a private dashboard without its install metadata", async () => {
    const result = await duplicateDashboard.run({
      id: "builtin-demo-node-exporter",
    });

    expect(result).toMatchObject({
      name: "Demo Node Exporter Full (copy)",
      copiedFrom: "builtin-demo-node-exporter",
    });
    const [id, kind, body, ctx] = mocks.upsertDashboard.mock.calls[0];
    expect(id).toMatch(/^sql-dashboard-/);
    expect(kind).toBe("sql");
    expect(ctx).toEqual({ email: "alice@example.com", orgId: "org-1" });
    expect(body).not.toHaveProperty("demo");
    expect(body).not.toHaveProperty("catalog");
    expect(body.panels).toEqual(BUILTIN.config.panels);
    expect(body.copiedFrom).toMatchObject({
      id: "builtin-demo-node-exporter",
      builtinVersion: "abc123",
    });
  });

  it("picks the next free copy name", async () => {
    mocks.listDashboardSummaries.mockResolvedValue([
      { name: "Demo Node Exporter Full (copy)" },
      { name: "demo node exporter full (copy 2)" },
    ]);

    const result = await duplicateDashboard.run({
      id: "builtin-demo-node-exporter",
    });

    expect(result.name).toBe("Demo Node Exporter Full (copy 3)");
  });

  it("copies a saved dashboard the caller can read", async () => {
    mocks.getDashboard.mockResolvedValue({
      id: "sales",
      kind: "sql",
      title: "Sales",
      hiddenBy: null,
      config: { name: "Sales", panels: [{ id: "p1" }] },
    });

    const result = await duplicateDashboard.run({ id: "sales", name: "Mine" });

    expect(mocks.loadBuiltinDashboard).not.toHaveBeenCalled();
    expect(result).toMatchObject({ name: "Mine", copiedFrom: "sales" });
  });

  it.each(["demo-node-exporter-0a1b2c3d", "builtin-risk-meeting"])(
    "does not duplicate hidden %s when its builtin is unavailable",
    async (id) => {
      mocks.getDashboard.mockResolvedValue({
        id,
        kind: "sql",
        title: "Stale copy",
        config: { name: "Stale copy", panels: [] },
        hiddenBy: "analytics:builtin-dashboards",
      });
      mocks.loadBuiltinDashboard.mockResolvedValue(null);
      await expect(duplicateDashboard.run({ id })).rejects.toThrow(
        /not found/i,
      );
      expect(mocks.upsertDashboard).not.toHaveBeenCalled();
      expect(mocks.listDashboardSummaries).not.toHaveBeenCalled();
    },
  );

  it("fails for a dashboard the caller can't read", async () => {
    mocks.loadBuiltinDashboard.mockResolvedValue(null);

    await expect(duplicateDashboard.run({ id: "nope" })).rejects.toThrow(
      /not found/i,
    );
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
  });
});
