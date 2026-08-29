import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: vi.fn(async () => ({
    userEmail: "admin@example.com",
    orgId: "org-1",
    role: "admin",
  })),
  certify: vi.fn(async (_id: string, _ctx: unknown) => ({
    id: "dashboard-1",
    kind: "sql",
    title: "Revenue",
    updatedAt: "v2",
    config: { name: "Revenue" },
    certification: {
      status: "certified" as const,
      certifiedAt: "2026-08-28T00:00:00.000Z",
      certifiedBy: "admin@example.com",
      certifiedForUpdatedAt: "v2",
    },
  })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "admin@example.com"),
}));
vi.mock("../server/lib/db-admin-connections", () => ({
  requireAnalyticsAdminContext: state.admin,
}));
vi.mock("../server/lib/dashboards-store", () => ({
  certifyDashboardWithRetry: state.certify,
}));

const { default: action } = await import("./certify-dashboard");

describe("certify-dashboard action", () => {
  beforeEach(() => {
    state.admin.mockClear();
    state.certify.mockClear();
  });

  it("requires admin context and returns the server-owned certification", async () => {
    const result = await (action as any).run({ id: "dashboard-1" });
    expect(state.admin).toHaveBeenCalled();
    expect(state.certify).toHaveBeenCalledWith("dashboard-1", {
      email: "admin@example.com",
      orgId: "org-1",
    });
    expect(result).toMatchObject({
      id: "dashboard-1",
      updatedAt: "v2",
      certified: true,
      certification: {
        status: "certified",
        certifiedBy: "admin@example.com",
        certifiedForUpdatedAt: "v2",
      },
    });
  });
});
