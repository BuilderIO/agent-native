import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDashboard: vi.fn(),
  values: vi.fn(async () => undefined),
  putPrivateBlob: vi.fn(async (_input: unknown) => ({
    key: "private-test-handle",
  })),
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "probe@example.test",
  getRequestOrgId: () => "org-test",
}));
vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: mocks.putPrivateBlob,
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({ insert: () => ({ values: mocks.values }) }),
  schema: { dashboardRevisions: "dashboard-revisions" },
}));
vi.mock("./open-dashboard.js", () => ({ openDashboard: mocks.openDashboard }));

import { nativeDashboardCreativeContextAdapter as adapter } from "./native-creative-context";

const builtin = {
  id: "builtin-risk-meeting",
  title: "Risk Meeting",
  version: "builtin-definition-v2",
  config: {
    name: "Risk Meeting",
    panels: [{ id: "current-panel", title: "Current cohort" }],
  },
};

describe("native dashboard creative context builtin reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openDashboard.mockResolvedValue({ builtin });
  });

  it("lists the opened builtin definition version", async () => {
    expect(await adapter.listResourceVersions!([builtin.id])).toEqual([
      { resourceId: builtin.id, sourceModifiedAt: builtin.version },
    ]);
    expect(mocks.openDashboard).toHaveBeenCalledWith(builtin.id, {
      email: "probe@example.test",
      orgId: "org-test",
    });
  });

  it("captures the builtin config with caller-owned snapshot storage", async () => {
    const result = await adapter.capture({
      appId: "analytics",
      resourceType: "dashboard",
      resourceId: builtin.id,
      expectedUpdatedAt: builtin.version,
    });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: builtin.id,
        config: JSON.stringify(builtin.config),
        ownerEmail: "probe@example.test",
        orgId: "org-test",
      }),
    );
    const blob = mocks.putPrivateBlob.mock.calls[0]?.[0] as any;
    expect(JSON.parse(blob.data.toString("utf8"))).toMatchObject({
      id: builtin.id,
      config: builtin.config,
      updatedAt: builtin.version,
    });
    expect(result.items[0]).toMatchObject({
      title: "Risk Meeting",
      sourceModifiedAt: builtin.version,
    });
  });

  it("rejects unavailable or changed builtins before writing snapshots", async () => {
    mocks.openDashboard.mockResolvedValueOnce(null);
    await expect(
      adapter.capture({
        appId: "analytics",
        resourceType: "dashboard",
        resourceId: builtin.id,
      }),
    ).rejects.toThrow("Dashboard not found");
    await expect(
      adapter.capture({
        appId: "analytics",
        resourceType: "dashboard",
        resourceId: builtin.id,
        expectedUpdatedAt: "old-definition",
      }),
    ).rejects.toThrow("Dashboard changed");
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.putPrivateBlob).not.toHaveBeenCalled();
  });
});
