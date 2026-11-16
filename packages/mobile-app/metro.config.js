const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  monorepoRoot,
  fs.realpathSync(path.resolve(monorepoRoot, "node_modules")),
  fs.realpathSync(path.resolve(projectRoot, "node_modules")),
  path.resolve(
    fs.realpathSync(path.resolve(projectRoot, "node_modules")),
    "../..",
  ),
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const mobileNodeModules = path.resolve(projectRoot, "node_modules");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "react" ||
    moduleName === "react/jsx-runtime" ||
    moduleName === "react/jsx-dev-runtime" ||
    moduleName === "react-dom" ||
    moduleName === "react-native"
  ) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.join(mobileNodeModules, ".package"),
      },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
});
