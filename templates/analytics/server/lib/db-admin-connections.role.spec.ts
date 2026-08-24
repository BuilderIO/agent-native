import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  createDbExec: () => ({ execute: state.execute }),
  getDbExec: () => ({ execute: state.execute }),
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => null,
}));

vi.mock("@agent-native/core/secrets", () => ({
  deleteAppSecret: vi.fn(),
  getAppSecretMeta: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org-1",
  getRequestUserEmail: () => "owner@example.com",
  getSession: async () => null,
  runWithRequestContext: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

const { requireAnalyticsAdminContext } = await import("./db-admin-connections");

describe("requireAnalyticsAdminContext", () => {
  it("reports an unreadable role lookup as unavailable, not as a denial", async () => {
    state.execute.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 503,
    });

    state.execute.mockResolvedValueOnce({ rows: [] });
    await expect(requireAnalyticsAdminContext()).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
