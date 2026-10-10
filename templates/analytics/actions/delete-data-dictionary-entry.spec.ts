import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(() => "org_test"),
  getRequestUserEmail: vi.fn(() => "user@example.test"),
  deleteOrgSetting: vi.fn(async () => undefined),
  deleteUserSetting: vi.fn(async () => undefined),
  requireAnalyticsAdminContext: vi.fn(async () => ({
    userEmail: "user@example.test",
    orgId: "org_test",
    role: "owner",
  })),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  deleteOrgSetting: mocks.deleteOrgSetting,
  deleteUserSetting: mocks.deleteUserSetting,
}));

vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.requireAnalyticsAdminContext,
}));

const { default: action } = await import("./delete-data-dictionary-entry");

describe("delete-data-dictionary-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAnalyticsAdminContext.mockResolvedValue({
      userEmail: "user@example.test",
      orgId: "org_test",
      role: "owner",
    });
  });

  it("rejects an org delete by a non-admin and does not delete", async () => {
    mocks.requireAnalyticsAdminContext.mockRejectedValueOnce(
      new Error(
        "Only organization owners and admins can use Analytics admin tools.",
      ),
    );

    await expect(
      action.run({ id: "current-model" }, {} as never),
    ).rejects.toThrow("Only organization owners and admins");

    expect(mocks.requireAnalyticsAdminContext).toHaveBeenCalledWith({
      userEmail: "user@example.test",
      orgId: "org_test",
    });
    expect(mocks.deleteOrgSetting).not.toHaveBeenCalled();
    expect(mocks.deleteUserSetting).not.toHaveBeenCalled();
  });

  it("deletes an org entry after the admin gate passes", async () => {
    await action.run({ id: "current-model" }, {} as never);

    expect(mocks.requireAnalyticsAdminContext).toHaveBeenCalledWith({
      userEmail: "user@example.test",
      orgId: "org_test",
    });
    expect(mocks.deleteOrgSetting).toHaveBeenCalledWith(
      "org_test",
      "data-dict-current-model",
    );
  });

  it("deletes a personal entry without an org and skips the admin gate", async () => {
    mocks.getRequestOrgId.mockReturnValueOnce("");

    await action.run({ id: "current-model" }, {} as never);

    expect(mocks.requireAnalyticsAdminContext).not.toHaveBeenCalled();
    expect(mocks.deleteOrgSetting).not.toHaveBeenCalled();
    expect(mocks.deleteUserSetting).toHaveBeenCalledWith(
      "user@example.test",
      "data-dict-current-model",
    );
  });
});
