import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: vi.fn(async () => ({
    userEmail: "admin@example.com",
    orgId: "org-1",
    role: "admin",
  })),
  save: vi.fn(
    async (_id: string, _ctx: unknown, mutate: (dashboard: any) => any) => {
      const existing = {
        id: "dashboard-1",
        kind: "sql",
        title: "Revenue",
        updatedAt: "v1",
        config: { name: "Revenue" },
      };
      return {
        ...existing,
        config: mutate(existing).body,
      };
    },
  ),
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
  upsertDashboardWithRetry: state.save,
}));

const { default: action } = await import("./certify-dashboard");

describe("certify-dashboard action", () => {
  beforeEach(() => {
    state.admin.mockClear();
    state.save.mockClear();
  });

  it("requires admin context and binds certification to the current version", async () => {
    const result = await (action as any).run({ id: "dashboard-1" });
    expect(state.admin).toHaveBeenCalled();
    expect(state.save).toHaveBeenCalledWith(
      "dashboard-1",
      { email: "admin@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    const mutate = state.save.mock.calls[0]?.[2] as (dashboard: any) => any;
    expect(
      mutate({
        kind: "sql",
        updatedAt: "v1",
        config: { name: "Revenue" },
      }),
    ).toMatchObject({ preserveUpdatedAt: true });
    expect(result).toMatchObject({
      id: "dashboard-1",
      updatedAt: "v1",
      certified: true,
      certification: {
        status: "certified",
        certifiedBy: "admin@example.com",
        certifiedForUpdatedAt: "v1",
      },
    });
  });
});
