import type { ConfigContext, ExpoConfig } from "expo/config";
import { type ConfigPlugin, withEntitlementsPlist } from "expo/config-plugins";

import appJson from "./app.json";

const DISABLE_REMOTE_PUSH =
  process.env.AGENT_NATIVE_MOBILE_DISABLE_REMOTE_PUSH === "1";

function withoutRemotePushPlugin(
  plugins: ExpoConfig["plugins"],
): ExpoConfig["plugins"] {
  if (!DISABLE_REMOTE_PUSH || !Array.isArray(plugins)) return plugins;
  return plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "expo-notifications";
  });
}

const withInstallPreviewNoPush: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults["aps-environment"];
    return entitlementsConfig;
  });
const withInstallPreviewNoPushPlugin =
  withInstallPreviewNoPush as unknown as NonNullable<
    ExpoConfig["plugins"]
  >[number];

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const plugins = withoutRemotePushPlugin(base.plugins);
  const appleTeamId = process.env.AGENT_NATIVE_APPLE_TEAM_ID?.trim();

  return {
    ...config,
    ...base,
    plugins: DISABLE_REMOTE_PUSH
      ? [...(plugins ?? []), withInstallPreviewNoPushPlugin]
      : plugins,
    ios: {
      ...base.ios,
      ...(appleTeamId ? { appleTeamId } : {}),
    },
    extra: {
      ...base.extra,
      disableRemotePush: DISABLE_REMOTE_PUSH,
    },
  };
};
