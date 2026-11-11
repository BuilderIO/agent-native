import { beforeEach, describe, expect, it, vi } from "vitest";

const registerFeatureFlags = vi.fn();
const getSetting = vi.fn();
const mutateFeatureFlagRules = vi.fn();
const captureError = vi.fn();
class FeatureFlagRulesError extends Error {}

vi.mock("./registry.js", () => ({
  CONNECT_APPS_FLAG: {
    key: "labs.connectApps",
    displayName: "Connect apps",
    description: "Show the experimental app connection surface.",
  },
  registerFeatureFlags,
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting,
}));
vi.mock("./store.js", () => ({
  FeatureFlagRulesError,
  mutateFeatureFlagRules,
}));
vi.mock("../server/capture-error.js", () => ({ captureError }));

const { createFeatureFlagsPlugin } = await import("./plugin.js");

describe("createFeatureFlagsPlugin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers flags without reading legacy settings by default", async () => {
    const flags = [{ key: "new-editor" }];

    await createFeatureFlagsPlugin({ flags })({} as never);

    expect(registerFeatureFlags).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "labs.connectApps" }),
        ...flags,
      ]),
    );
    expect(getSetting).not.toHaveBeenCalled();
  });

  it("migrates only legacy true values into an otherwise unconfigured flag", async () => {
    getSetting.mockResolvedValue({ enabled: true, disabled: false });
    mutateFeatureFlagRules.mockImplementation(async (_key, _scope, updater) =>
      updater({
        version: 1,
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
        updatedAt: null,
        updatedBy: null,
      }),
    );

    await createFeatureFlagsPlugin({
      flags: [{ key: "enabled" }, { key: "disabled" }],
      legacyBooleanSetting: {
        settingKey: "feature-flags",
        flagKeys: ["enabled", "disabled"],
      },
    })({} as never);

    expect(getSetting).toHaveBeenCalledWith("feature-flags");
    expect(mutateFeatureFlagRules).toHaveBeenCalledOnce();
    expect(mutateFeatureFlagRules).toHaveBeenCalledWith(
      "enabled",
      {},
      expect.any(Function),
    );
    expect(
      mutateFeatureFlagRules.mock.calls[0][2]({
        version: 1,
        mode: "off",
        emails: [],
        orgIds: [],
        percentage: 0,
        updatedAt: null,
        updatedBy: null,
      }),
    ).toMatchObject({
      mode: "on",
      updatedBy: "legacy-settings-migration",
    });
  });

  it("preserves an explicit rule when a legacy true value still exists", async () => {
    getSetting.mockResolvedValue({ enabled: true });
    const explicit = {
      version: 1 as const,
      mode: "off" as const,
      emails: [],
      orgIds: [],
      percentage: 0,
      updatedAt: 123,
      updatedBy: "admin@example.com",
    };
    mutateFeatureFlagRules.mockImplementation(async (_key, _scope, updater) =>
      updater(explicit),
    );

    await createFeatureFlagsPlugin({
      flags: [{ key: "enabled" }],
      legacyBooleanSetting: {
        settingKey: "feature-flags",
        flagKeys: ["enabled"],
      },
    })({} as never);

    expect(mutateFeatureFlagRules.mock.calls[0][2](explicit)).toEqual(explicit);
  });

  it("leaves an unreadable rule for an operator and migrates the other flags", async () => {
    getSetting.mockResolvedValue({ unreadable: true, enabled: true });
    const unreadable = new FeatureFlagRulesError("stored rules are not JSON");
    mutateFeatureFlagRules.mockImplementation(async (key) => {
      if (key === "unreadable") throw unreadable;
      return {};
    });

    await expect(
      createFeatureFlagsPlugin({
        flags: [{ key: "unreadable" }, { key: "enabled" }],
        legacyBooleanSetting: {
          settingKey: "feature-flags",
          flagKeys: ["unreadable", "enabled"],
        },
      })({} as never),
    ).resolves.toBeUndefined();

    expect(mutateFeatureFlagRules).toHaveBeenCalledWith(
      "enabled",
      {},
      expect.any(Function),
    );
    expect(captureError).toHaveBeenCalledWith(unreadable, {
      tags: { source: "feature-flags", op: "legacy-settings-migration" },
    });
  });

  it("still fails boot on an error that isn't about the stored rule", async () => {
    getSetting.mockResolvedValue({ enabled: true });
    mutateFeatureFlagRules.mockRejectedValue(new Error("database unavailable"));

    await expect(
      createFeatureFlagsPlugin({
        flags: [{ key: "enabled" }],
        legacyBooleanSetting: {
          settingKey: "feature-flags",
          flagKeys: ["enabled"],
        },
      })({} as never),
    ).rejects.toThrow("database unavailable");
    expect(captureError).not.toHaveBeenCalled();
  });
});
