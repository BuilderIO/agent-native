import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreDashboardRevision = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/dashboards-store", () => ({
  restoreDashboardRevision,
}));

vi.mock("@agent-native/core/collab", () => ({
  applyText: vi.fn(),
  hasCollabState: vi.fn().mockResolvedValue(false),
  seedFromText: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => null,
  getRequestUserEmail: () => "alice@example.com",
}));

const { default: restoreDashboard } =
  await import("./restore-dashboard-revision");

describe("restore-dashboard-revision action", () => {
  beforeEach(() => {
    restoreDashboardRevision.mockReset();
  });

  it("returns a 404-shaped error when the revision is gone", async () => {
    restoreDashboardRevision.mockResolvedValue(null);

    await expect(
      restoreDashboard.run({
        dashboardId: "dashboard-1",
        revisionId: "revision-missing",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message:
        'Dashboard revision "revision-missing" was not found for dashboard "dashboard-1".',
    });
  });
});
