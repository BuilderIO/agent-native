import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(async () => ({})),
  setResourceVisibility: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../dashboards-store", () => ({
  getDashboard: mocks.getDashboard,
  upsertDashboard: mocks.upsertDashboard,
}));
vi.mock("@agent-native/core/sharing/actions/set-resource-visibility", () => ({
  default: { run: mocks.setResourceVisibility },
}));

import { contentDashboardId, ensureContentDashboard } from "./dashboard";

const ADMIN = { userEmail: "admin@example.test", orgId: "org_a" };

describe("ensureContentDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the catalog dashboard for the organization and shares it with the org", async () => {
    mocks.getDashboard.mockResolvedValue(null);
    const result = await ensureContentDashboard(ADMIN);

    expect(result).toEqual({
      dashboardId: contentDashboardId("org_a"),
      created: true,
    });
    expect(contentDashboardId("org_a")).not.toBe(contentDashboardId("org_b"));
    const [id, kind, body, ctx] = mocks.upsertDashboard.mock
      .calls[0] as unknown as [
      string,
      string,
      { name: string; catalog: { templateId: string } },
      unknown,
    ];
    expect(id).toBe(result.dashboardId);
    expect(kind).toBe("sql");
    expect(body.name).toBe("Content");
    expect(body.catalog.templateId).toBe("content-view");
    expect(ctx).toEqual({ email: "admin@example.test", orgId: "org_a" });
    expect(mocks.setResourceVisibility).toHaveBeenCalledWith({
      resourceType: "dashboard",
      resourceId: result.dashboardId,
      visibility: "org",
    });
  });

  it("keeps an existing copy, edits included", async () => {
    mocks.getDashboard.mockResolvedValue({ id: contentDashboardId("org_a") });
    expect(await ensureContentDashboard(ADMIN)).toEqual({
      dashboardId: contentDashboardId("org_a"),
      created: false,
    });
    expect(mocks.upsertDashboard).not.toHaveBeenCalled();
    expect(mocks.setResourceVisibility).not.toHaveBeenCalled();
  });
});
