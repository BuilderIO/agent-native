export {
  createPtyWebSocketServer,
  type PtyServerOptions,
  type PtyServerResult,
} from "./pty-server.js";
export {
  createTerminalPlugin,
  defaultTerminalPlugin,
  type TerminalPluginOptions,
} from "./terminal-plugin.js";
export {
  CLI_REGISTRY,
  commandExists,
  isAllowedCommand,
  type CliEntry,
} from "./cli-registry.js";
