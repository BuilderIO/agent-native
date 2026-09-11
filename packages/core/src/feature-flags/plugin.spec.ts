import { beforeEach, describe, expect, it, vi } from "vitest";

const registerFeatureFlags = vi.fn();
const getSetting = vi.fn();
const mutateFeatureFlagRules = vi.fn();

vi.mock("./registry.js", () => ({ registerFeatureFlags }));
vi.mock("../settings/store.js", () => ({ getSetting }));
vi.mock("./store.js", () => ({ mutateFeatureFlagRules }));

const { createFeatureFlagsPlugin } = await import("./plugin.js");

describe("createFeatureFlagsPlugin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers flags without reading legacy settings by default", async () => {
    const flags = [{ key: "new-editor" }];

    await createFeatureFlagsPlugin({ flags })({} as never);

    expect(registerFeatureFlags).toHaveBeenCalledWith(flags);
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
});
