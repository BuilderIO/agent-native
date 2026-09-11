import { beforeEach, describe, expect, it, vi } from "vitest";

const migrateAnalyticsArtifacts = vi.fn();
const requireAnalyticsAdminContext = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "admin@example.com",
}));

vi.mock("../server/lib/db-admin-connections", () => ({
  requireAnalyticsAdminContext,
}));

vi.mock("../server/lib/migrate-analytics-artifacts.js", () => ({
  migrateAnalyticsArtifacts,
}));

const { default: migrateAction } =
  await import("./migrate-analytics-artifacts");

describe("migrate-analytics-artifacts action", () => {
  beforeEach(() => {
    migrateAnalyticsArtifacts.mockReset();
    requireAnalyticsAdminContext.mockReset();
    requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "admin@example.com",
      orgId: "org-1",
      role: "owner",
    });
    migrateAnalyticsArtifacts.mockResolvedValue({
      dryRun: true,
      orgId: "org-1",
      dashboardsCreated: 0,
    });
  });

  it("defaults the supported path to a read-only inventory", async () => {
    await migrateAction.run({ dryRun: true }, {} as never);

    expect(migrateAnalyticsArtifacts).toHaveBeenCalledWith(
      { userEmail: "admin@example.com", orgId: "org-1" },
      { dryRun: true },
    );
  });

  it("requires the explicit confirmation token before writing", async () => {
    await expect(
      migrateAction.run({ dryRun: false }, {} as never),
    ).rejects.toThrow("MIGRATE_ANALYTICS_ARTIFACTS");
    expect(migrateAnalyticsArtifacts).not.toHaveBeenCalled();
  });

  it("passes the confirmed write through to the org-scoped migration", async () => {
    migrateAnalyticsArtifacts.mockResolvedValueOnce({
      dryRun: false,
      orgId: "org-1",
      dashboardsCreated: 4,
    });

    await migrateAction.run(
      {
        dryRun: false,
        confirm: "MIGRATE_ANALYTICS_ARTIFACTS",
      },
      {} as never,
    );

    expect(migrateAnalyticsArtifacts).toHaveBeenCalledWith(
      { userEmail: "admin@example.com", orgId: "org-1" },
      { dryRun: false },
    );
  });
});
