// Main entry point — re-exports from all subpackages for convenience.
// Prefer importing from specific subpaths (e.g. "@agent-native/core/server")
// for better tree-shaking and to avoid pulling in unnecessary dependencies.

export {
  createServer,
  createFileWatcher,
  createSSEHandler,
  createProductionServer,
} from "./server/index.js";

export { sendToFusionChat, useFusionChatGenerating, useFileWatcher, cn } from "./client/index.js";

export { fusionChat } from "./shared/index.js";

export {
  runScript,
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidPath,
  isValidProjectPath,
  ensureDir,
  fail,
} from "./scripts/index.js";
