import { isActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orgId: vi.fn<() => string | undefined>(() => "org-1"),
  email: vi.fn<() => string | undefined>(() => "owner@example.test"),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
  getBuiltinAgents: vi.fn(),
  loadWorkspaceAppsManifest: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => mocks.orgId(),
  getRequestUserEmail: () => mocks.email(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
  putOrgSetting: mocks.putOrgSetting,
  putUserSetting: mocks.putUserSetting,
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  getBuiltinAgents: mocks.getBuiltinAgents,
  loadWorkspaceAppsManifest: mocks.loadWorkspaceAppsManifest,
  normalizeAgentId: (id: string) => id.trim().toLowerCase(),
}));

import {
  hideHostedAppsWhenOff,
  HOSTED_APPS_SETTINGS_KEY,
  InvalidHostedAppsSettingsError,
  listHostedApps,
  readHostedAppsSettings,
  setHostedAppsSettings,
} from "./hosted-apps-settings.js";

const agent = (id: string) => ({
  id,
  name: id,
  description: "",
  url: `https://${id}.example.test`,
  color: "#000000",
});

describe("hosted apps settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgId.mockReturnValue("org-1");
    mocks.email.mockReturnValue("owner@example.test");
    mocks.getBuiltinAgents.mockReturnValue([agent("mail"), agent("slides")]);
    mocks.loadWorkspaceAppsManifest.mockResolvedValue([{ id: "Slides" }]);
  });

  it("shows hosted apps when the org has never set it", async () => {
    mocks.getOrgSetting.mockResolvedValue(null);
    await expect(readHostedAppsSettings()).resolves.toEqual({
      showHostedApps: true,
      invalid: false,
    });
    expect(mocks.getOrgSetting).toHaveBeenCalledWith(
      "org-1",
      HOSTED_APPS_SETTINGS_KEY,
    );
  });

  it("reads the stored org value", async () => {
    mocks.getOrgSetting.mockResolvedValue({ showHostedApps: false });
    await expect(readHostedAppsSettings()).resolves.toEqual({
      showHostedApps: false,
      invalid: false,
    });
  });

  it("falls back to the user's setting without an org", async () => {
    mocks.orgId.mockReturnValue(undefined);
    mocks.getUserSetting.mockResolvedValue({ showHostedApps: false });
    await expect(readHostedAppsSettings()).resolves.toEqual({
      showHostedApps: false,
      invalid: false,
    });
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      HOSTED_APPS_SETTINGS_KEY,
    );

    await setHostedAppsSettings({ showHostedApps: true });
    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      HOSTED_APPS_SETTINGS_KEY,
      { showHostedApps: true },
    );
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("reports an invalid stored value and hides hosted apps for it", async () => {
    mocks.getOrgSetting.mockResolvedValue({ showHostedApps: "no" });
    await expect(readHostedAppsSettings()).resolves.toEqual({
      showHostedApps: false,
      invalid: true,
    });
    expect(
      (await hideHostedAppsWhenOff([agent("mail"), agent("partner")])).map(
        (a) => a.id,
      ),
    ).toEqual(["partner"]);
  });

  it("types the invalid-setting error so Settings can offer the repair", () => {
    const error = new InvalidHostedAppsSettingsError();
    expect(isActionContractError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "dispatch_hosted_apps_settings_invalid",
      statusCode: 409,
    });
  });

  it("propagates a settings read failure", async () => {
    mocks.getOrgSetting.mockRejectedValue(new Error("db down"));
    await expect(readHostedAppsSettings()).rejects.toThrow("db down");
    await expect(hideHostedAppsWhenOff([agent("mail")])).rejects.toThrow(
      "db down",
    );
  });

  it("writes the org setting", async () => {
    await setHostedAppsSettings({ showHostedApps: false });
    expect(mocks.putOrgSetting).toHaveBeenCalledWith(
      "org-1",
      HOSTED_APPS_SETTINGS_KEY,
      { showHostedApps: false },
    );
  });

  it("treats a mounted workspace app with a built-in id as not hosted", async () => {
    expect((await listHostedApps()).map((app) => app.id)).toEqual(["mail"]);
  });

  it("removes only hosted apps from agent context when off", async () => {
    const agents = [agent("mail"), agent("slides"), agent("partner")];
    mocks.getOrgSetting.mockResolvedValue({ showHostedApps: true });
    expect(await hideHostedAppsWhenOff(agents)).toEqual(agents);

    mocks.getOrgSetting.mockResolvedValue({ showHostedApps: false });
    expect((await hideHostedAppsWhenOff(agents)).map((a) => a.id)).toEqual([
      "slides",
      "partner",
    ]);
  });
});
