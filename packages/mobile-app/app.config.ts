import type { ConfigContext, ExpoConfig } from "expo/config";
import { type ConfigPlugin, withEntitlementsPlist } from "expo/config-plugins";

import appJson from "./app.json";

const DISABLE_REMOTE_PUSH =
  process.env.AGENT_NATIVE_MOBILE_DISABLE_REMOTE_PUSH === "1";
const DISABLE_APP_EXTENSIONS =
  process.env.AGENT_NATIVE_MOBILE_DISABLE_APP_EXTENSIONS === "1";

function withoutRemotePushPlugin(
  plugins: ExpoConfig["plugins"],
): ExpoConfig["plugins"] {
  if (!DISABLE_REMOTE_PUSH || !Array.isArray(plugins)) return plugins;
  return plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "expo-notifications";
  });
}

function withoutAppExtensionsPlugin(
  plugins: ExpoConfig["plugins"],
): ExpoConfig["plugins"] {
  if (!DISABLE_APP_EXTENSIONS || !Array.isArray(plugins)) return plugins;
  return plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "@bacons/apple-targets";
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
  const plugins = withoutAppExtensionsPlugin(
    withoutRemotePushPlugin(base.plugins),
  );
  const appleTeamId = process.env.AGENT_NATIVE_APPLE_TEAM_ID?.trim();
  const entitlements = { ...(base.ios?.entitlements ?? {}) };
  if (DISABLE_APP_EXTENSIONS) {
    delete entitlements["com.apple.security.application-groups"];
  }

  return {
    ...config,
    ...base,
    plugins: DISABLE_REMOTE_PUSH
      ? [...(plugins ?? []), withInstallPreviewNoPushPlugin]
      : plugins,
    ios: {
      ...base.ios,
      ...(DISABLE_APP_EXTENSIONS ? { entitlements } : {}),
      ...(appleTeamId ? { appleTeamId } : {}),
    },
    extra: {
      ...base.extra,
      disableRemotePush: DISABLE_REMOTE_PUSH,
      disableAppExtensions: DISABLE_APP_EXTENSIONS,
    },
  };
};
