import {
  registerFeatureFlags,
  type FeatureFlagDefinition,
} from "./registry.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

/** A tiny startup plugin for app-local, explicit feature-flag registration. */
export function createFeatureFlagsPlugin(options: {
  flags: readonly FeatureFlagDefinition[];
}): NitroPluginDef {
  return () => registerFeatureFlags(options.flags);
}
