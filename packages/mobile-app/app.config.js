const { withEntitlementsPlist } = require("expo/config-plugins");
const appJson = require("./app.json");

const DISABLE_REMOTE_PUSH =
  process.env.AGENT_NATIVE_MOBILE_DISABLE_REMOTE_PUSH === "1";

function withoutRemotePushPlugin(plugins) {
  if (!DISABLE_REMOTE_PUSH || !Array.isArray(plugins)) return plugins;
  return plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "expo-notifications";
  });
}

const withInstallPreviewNoPush = (config) =>
  withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults["aps-environment"];
    return entitlementsConfig;
  });
const withInstallPreviewNoPushPlugin = withInstallPreviewNoPush;

module.exports = ({ config }) => {
  const base = appJson.expo;
  const plugins = withoutRemotePushPlugin(base.plugins);

  return {
    ...config,
    ...base,
    plugins: DISABLE_REMOTE_PUSH
      ? [...(plugins ?? []), withInstallPreviewNoPushPlugin]
      : plugins,
    extra: {
      ...base.extra,
      disableRemotePush: DISABLE_REMOTE_PUSH,
    },
  };
};
