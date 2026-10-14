import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgSetting = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "org_1",
  getRequestUserEmail: () => "owner@example.test",
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting,
  getUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

const { readGongNativeInsightsPolicy } = await import("./gong-native-policy");

describe("readGongNativeInsightsPolicy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is on until a workspace owner turns it off", async () => {
    getOrgSetting.mockResolvedValue(null);
    await expect(readGongNativeInsightsPolicy()).resolves.toMatchObject({
      enabled: true,
      configured: false,
    });

    getOrgSetting.mockResolvedValue({ enabled: false });
    await expect(readGongNativeInsightsPolicy()).resolves.toMatchObject({
      enabled: false,
      configured: true,
    });
  });

  it("fails closed on a stored value that is not true", async () => {
    getOrgSetting.mockResolvedValue({ enabled: "yes" });
    await expect(readGongNativeInsightsPolicy()).resolves.toMatchObject({
      enabled: false,
    });
  });
});
