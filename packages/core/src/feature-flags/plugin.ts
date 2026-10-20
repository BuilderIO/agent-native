import { getSetting } from "../settings/store.js";
import {
  CONNECT_APPS_FLAG,
  registerFeatureFlags,
  type FeatureFlagDefinition,
} from "./registry.js";
import { mutateFeatureFlagRules } from "./store.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createFeatureFlagsPlugin(options: {
  flags: readonly FeatureFlagDefinition[];
  legacyBooleanSetting?: {
    settingKey: string;
    flagKeys: readonly string[];
  };
}): NitroPluginDef {
  return async () => {
    registerFeatureFlags([CONNECT_APPS_FLAG, ...options.flags]);
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
