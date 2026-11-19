import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeOrgOwnerOrAdmin: vi.fn(),
  email: vi.fn<() => string | undefined>(() => "member@example.test"),
  readHostedAppsSettings: vi.fn(),
  setHostedAppsSettings: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => mocks.email(),
}));

vi.mock("../server/lib/app-roles.js", () => ({
  authorizeOrgOwnerOrAdmin: mocks.authorizeOrgOwnerOrAdmin,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  recordAudit: mocks.recordAudit,
}));

vi.mock("../server/lib/hosted-apps-settings.js", async (importOriginal) => ({
  InvalidHostedAppsSettingsError: (
    await importOriginal<
      typeof import("../server/lib/hosted-apps-settings.js")
    >()
  ).InvalidHostedAppsSettingsError,
  HOSTED_APPS_SETTINGS_KEY: "dispatch-hosted-apps-settings",
  readHostedAppsSettings: mocks.readHostedAppsSettings,
  setHostedAppsSettings: mocks.setHostedAppsSettings,
}));

const getAction = (await import("./get-hosted-apps-settings.js")).default;
const setAction = (await import("./set-hosted-apps-settings.js")).default;

describe("hosted apps settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.email.mockReturnValue("member@example.test");
    mocks.readHostedAppsSettings.mockResolvedValue({
      showHostedApps: false,
      invalid: false,
    });
    mocks.setHostedAppsSettings.mockImplementation(async (value) => value);
    mocks.authorizeOrgOwnerOrAdmin.mockResolvedValue(undefined);
  });

  it("lets any signed-in member read the setting", async () => {
    await expect(getAction.run({})).resolves.toEqual({
      showHostedApps: false,
    });
    expect(mocks.authorizeOrgOwnerOrAdmin).not.toHaveBeenCalled();
  });

  it("refuses to read without a signed-in user", async () => {
    mocks.email.mockReturnValue(undefined);
    await expect(getAction.run({})).rejects.toThrow("Sign in");
    expect(mocks.readHostedAppsSettings).not.toHaveBeenCalled();
  });

  it("reports an invalid stored value with the code Settings repairs from", async () => {
    mocks.readHostedAppsSettings.mockResolvedValue({
      showHostedApps: false,
      invalid: true,
    });
    await expect(getAction.run({})).rejects.toMatchObject({
      errorCode: "dispatch_hosted_apps_settings_invalid",
      statusCode: 409,
    });
  });

  it("denies callers who are not org owners or admins before writing", async () => {
    mocks.authorizeOrgOwnerOrAdmin.mockRejectedValue(
      Object.assign(new Error("Only organization owners and admins"), {
        statusCode: 403,
      }),
    );
    await expect(setAction.run({ showHostedApps: false })).rejects.toThrow(
      "Only organization owners and admins",
    );
    expect(mocks.setHostedAppsSettings).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("writes, records the change in Dispatch's audit log, and returns the read shape", async () => {
    await expect(setAction.run({ showHostedApps: false })).resolves.toEqual({
      showHostedApps: false,
    });
    expect(mocks.setHostedAppsSettings).toHaveBeenCalledWith({
      showHostedApps: false,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "dispatch-hosted-apps-settings",
        summary: "Hid Agent-Native.com hosted apps",
      }),
    );
  });
});
