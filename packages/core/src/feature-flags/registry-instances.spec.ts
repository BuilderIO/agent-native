import { afterEach, describe, expect, it, vi } from "vitest";

describe("feature flag registry across module instances", () => {
  afterEach(async () => {
    const registry = await import("./registry.js");
    registry._resetFeatureFlagRegistryForTests();
    vi.resetModules();
  });

  it("shares definitions between a plugin's copy and an action's copy", async () => {
    // A dev server can load an app plugin and the flag actions through two
    // module instances of the registry; both must see one set of flags.
    const pluginCopy = await import("./registry.js");
    vi.resetModules();
    const actionCopy = await import("./registry.js");
    expect(actionCopy).not.toBe(pluginCopy);

    pluginCopy.registerFeatureFlags([pluginCopy.SETTINGS_REDESIGN_FLAG]);

    expect(actionCopy.getFeatureFlagDefinition("settings-redesign")).toEqual(
      pluginCopy.SETTINGS_REDESIGN_FLAG,
    );
  });
});
