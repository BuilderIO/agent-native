// Server-side framework for agent-native apps.
// Browser-side utilities are in @agent-native/client.

// Server
export {
  createServer,
  createFileWatcher,
  createSSEHandler,
  createProductionServer,
  type CreateServerOptions,
  type FileWatcherOptions,
  type SSEHandlerOptions,
  type ProductionServerOptions,
} from "./server/index.js";

// Scripts
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
