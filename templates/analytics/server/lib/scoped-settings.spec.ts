import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => ({
  deleteSetting: vi.fn(),
  getUserSetting: vi.fn(),
  listSettingsByPrefix: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({ getOrgContext: vi.fn() }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({
  deleteOrgSetting: vi.fn(),
  deleteSetting: settingsMock.deleteSetting,
  deleteUserSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: settingsMock.getUserSetting,
  listOrgSettings: vi.fn(),
  listSettingsByPrefix: settingsMock.listSettingsByPrefix,
  putOrgSetting: vi.fn(),
  putUserSetting: settingsMock.putUserSetting,
}));

const { migrateGlobalSettingsPrefixesToUser } =
  await import("./scoped-settings.js");

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.listSettingsByPrefix.mockResolvedValue([
    { key: "analytics:dashboard", value: { id: "dashboard" } },
  ]);
  settingsMock.getUserSetting.mockResolvedValue(null);
});

describe("migrateGlobalSettingsPrefixesToUser", () => {
  it("reads only requested global prefixes", async () => {
    await expect(
      migrateGlobalSettingsPrefixesToUser(
        { email: "alice@example.com", orgId: null },
        ["analytics:"],
      ),
    ).resolves.toEqual({
      migrated: 1,
      keys: ["analytics:dashboard"],
    });

    expect(settingsMock.listSettingsByPrefix).toHaveBeenCalledWith(
      "analytics:",
    );
    expect(settingsMock.putUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "analytics:dashboard",
      { id: "dashboard" },
    );
    expect(settingsMock.deleteSetting).toHaveBeenCalledWith(
      "analytics:dashboard",
    );
  });

  it("refuses an empty prefix that would enumerate every setting", async () => {
    await expect(
      migrateGlobalSettingsPrefixesToUser(
        { email: "alice@example.com", orgId: null },
        [""],
      ),
    ).rejects.toThrow("Settings migration prefixes must be non-empty.");
    expect(settingsMock.listSettingsByPrefix).not.toHaveBeenCalled();
  });
});
