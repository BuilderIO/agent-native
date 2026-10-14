import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrgSetting = vi.hoisted(() => vi.fn());
const putOrgSetting = vi.hoisted(() => vi.fn());
const resolveOrgRole = vi.hoisted(() => vi.fn());

const requestOrgId = vi.hoisted(() => ({ value: "org_1" as string | null }));
const requestEmail = vi.hoisted(() => ({
  value: "owner@example.test" as string | null,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => requestOrgId.value,
  getRequestUserEmail: () => requestEmail.value,
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting,
  getUserSetting: vi.fn(),
  putOrgSetting,
  putUserSetting: vi.fn(),
}));

vi.mock("./db-admin-connections", () => ({ resolveOrgRole }));

const { readGongNativeInsightsPolicy, writeGongNativeInsightsPolicy } =
  await import("./gong-native-policy");

describe("readGongNativeInsightsPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestOrgId.value = "org_1";
    requestEmail.value = "owner@example.test";
  });

  it("lets only owners and admins change the workspace policy", async () => {
    resolveOrgRole.mockResolvedValue("member");
    await expect(writeGongNativeInsightsPolicy(false)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(putOrgSetting).not.toHaveBeenCalled();

    resolveOrgRole.mockResolvedValue("admin");
    await expect(writeGongNativeInsightsPolicy(false)).resolves.toMatchObject({
      enabled: false,
      scope: "workspace",
    });
    expect(putOrgSetting).toHaveBeenCalledOnce();
  });

  it("fails closed when there is no workspace or user to read a policy from", async () => {
    requestOrgId.value = null;
    requestEmail.value = null;
    await expect(readGongNativeInsightsPolicy()).resolves.toMatchObject({
      enabled: false,
      scope: "none",
    });
  });

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
