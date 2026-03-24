const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root for changes in shared packages
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and monorepo node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Block duplicate React — redirect all react imports to the mobile-app's copy
const mobileNodeModules = path.resolve(projectRoot, "node_modules");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force react/react-native to resolve from the mobile app's node_modules
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

module.exports = config;
