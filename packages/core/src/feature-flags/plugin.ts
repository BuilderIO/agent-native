import { getSetting } from "../settings/store.js";
import {
  registerFeatureFlags,
  type FeatureFlagDefinition,
} from "./registry.js";
import { mutateFeatureFlagRules } from "./store.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** A tiny startup plugin for app-local, explicit feature-flag registration. */
export function createFeatureFlagsPlugin(options: {
  flags: readonly FeatureFlagDefinition[];
  /**
   * One-time compatibility bridge for apps that previously stored global
   * booleans together in a single settings object. Only legacy `true` values
   * are copied, and an explicit rule in the new store always wins.
   */
  legacyBooleanSetting?: {
    settingKey: string;
    flagKeys: readonly string[];
  };
}): NitroPluginDef {
  return async () => {
    registerFeatureFlags(options.flags);
    if (!options.legacyBooleanSetting) return;

    const legacy = await getSetting(options.legacyBooleanSetting.settingKey);
    if (!legacy) return;
    await Promise.all(
      options.legacyBooleanSetting.flagKeys.map(async (key) => {
        if (legacy[key] !== true) return;
        await mutateFeatureFlagRules(key, {}, (current) => {
          if (current.updatedAt !== null) return current;
          return {
            ...current,
            mode: "on",
            updatedAt: Date.now(),
            updatedBy: "legacy-settings-migration",
          };
        });
      }),
    );
  };
}
