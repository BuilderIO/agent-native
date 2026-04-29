import { getH3App } from "../server/framework-request-handler.js";
import { isNodeRuntime } from "../shared/runtime.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
/**
 * Nitro Plugin — Agent Terminal
 *
 * Starts a PTY WebSocket server alongside the app so the <AgentTerminal />
 * component can connect to a real CLI. Mounts a discovery endpoint at
 * /_agent-native/agent-terminal-info for the client component.
 *
 * Skips activation when running inside a frame (FRAME_PORT is set).
 */

import { defineEventHandler } from "h3";

// ─── module-load self-heal: chmod node-pty's spawn-helper ─────────────────
// pnpm can extract node-pty's prebuilds tarball without running the
// post-install that chmods spawn-helper, leaving it as `-rw-r--r--` instead
// of `-rwxr-xr-x`. Every PTY spawn then fails with `posix_spawnp failed`.
// Run the fix synchronously at module load (static imports, sync fs calls)
// so by the time ANY plugin worker starts spawning PTYs, the helper is
// already executable.
(function fixSpawnHelperPermissions() {
  if (!isNodeRuntime()) return;
  try {
    const req = createRequire(import.meta.url);
    const ptyPkg = req.resolve("node-pty/package.json");
    const ptyDir = path.dirname(ptyPkg);
    const helper = path.join(
      ptyDir,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    if (fs.existsSync(helper)) {
      const mode = fs.statSync(helper).mode;
      if (!(mode & 0o100)) {
        fs.chmodSync(helper, 0o755);
        console.log(
          `[terminal] Fixed non-executable node-pty spawn-helper at ${helper}`,
        );
      }
    }
  } catch (err) {
    // node-pty not installed → stay silent here; createTerminalPlugin emits
    // the "install node-pty" message when the PTY server actually fails to
    // start. Logging twice for the same root cause just adds noise.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") return;
    console.warn(
      "[terminal] Could not verify node-pty spawn-helper permissions:",
      (err as Error).message,
    );
  }
})();

export interface TerminalPluginOptions {
  /** CLI command to run. Defaults to AGENT_CLI_COMMAND env or 'builder' */
  command?: string;
  /** Port for the WebSocket server. Defaults to AGENT_TERMINAL_PORT env or auto-assigned */
  port?: number;
  /** Enable in production. Defaults to AGENT_TERMINAL_ENABLED env or false in prod */
  enabledInProduction?: boolean;
  /** Auth check for WebSocket connections in production */
  authCheck?: (req: any) => boolean | Promise<boolean>;
}

export function createTerminalPlugin(options: TerminalPluginOptions = {}) {
  return async (nitroApp: any) => {
    // Terminal requires Node.js (PTY, child_process) — skip on edge runtimes
    if (!isNodeRuntime()) return;

    // Always mount /_agent-native/available-clis so the client doesn't get 404s
    getH3App(nitroApp).use(
      "/_agent-native/available-clis",
      defineEventHandler(async () => {
        try {
          const { CLI_REGISTRY, commandExists } =
            await import("./cli-registry.js");
          const results = [];
          for (const [cmd, entry] of Object.entries(CLI_REGISTRY)) {
            results.push({
              command: cmd,
              label: entry.label,
              available: await commandExists(cmd),
            });
          }
          return results;
        } catch {
          return [];
        }
      }),
    );

    // Skip if running inside a frame
    if (process.env.FRAME_PORT) {
      console.log("[terminal] Frame detected, skipping embedded terminal");
      return;
    }

    const isProd = process.env.NODE_ENV === "production";
    const enabled =
      options.enabledInProduction ??
      (process.env.AGENT_TERMINAL_ENABLED === "true" || !isProd);

    if (!enabled) {
      console.log(
        "[terminal] Disabled in production (set AGENT_TERMINAL_ENABLED=true to enable)",
      );
      // Mount a disabled info endpoint
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({ available: false })),
      );
      return;
    }

    // Require authCheck in production to prevent unauthenticated shell access
    if (isProd && !options.authCheck) {
      console.error(
        "[terminal] FATAL: authCheck is required when enabling the terminal in production. " +
          "Pass an authCheck function to createTerminalPlugin().",
      );
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: false,
          error: "Terminal requires authCheck in production",
        })),
      );
      return;
    }

    // Skip if a PTY server is already running (prevents leak on HMR rebuild)
    if (process.env.__AGENT_TERMINAL_RUNNING === "true") {
      const existingPort = process.env.AGENT_TERMINAL_PORT;
      console.log(
        `[terminal] PTY server already running on port ${existingPort}, skipping`,
      );
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: true,
          wsPort: existingPort ? parseInt(existingPort, 10) : 0,
          command:
            options.command || process.env.AGENT_CLI_COMMAND || "builder",
        })),
      );
      return;
    }

    const command =
      options.command || process.env.AGENT_CLI_COMMAND || "builder";
    const port =
      options.port ??
      (process.env.AGENT_TERMINAL_PORT
        ? parseInt(process.env.AGENT_TERMINAL_PORT, 10)
        : 0);

    // Mark as running BEFORE the async server start. The previous code only
    // set this AFTER `await createPtyWebSocketServer(...)`, which left a
    // TOCTOU window where two concurrent plugin invocations would both pass
    // the running-check, both spawn a server, and end up fighting for the
    // CLI's PTY pool — leading to `posix_spawnp failed` floods.
    process.env.__AGENT_TERMINAL_RUNNING = "true";

    try {
      const { createPtyWebSocketServer } = await import("./pty-server.js");

      const result = await createPtyWebSocketServer({
        appDir: process.cwd(),
        command,
        port,
        authCheck: isProd ? options.authCheck : undefined,
        logPrefix: "[terminal]",
      });

      // Store port for other consumers
      process.env.AGENT_TERMINAL_PORT = String(result.port);

      // Mount discovery endpoint
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: true,
          wsPort: result.port,
          command,
        })),
      );

      // Cleanup on shutdown (use once to avoid listener leak on hot-reload)
      const cleanup = () => result.close();
      process.once("SIGTERM", cleanup);
      process.once("SIGINT", cleanup);
      process.once("exit", cleanup);

      if (process.env.DEBUG)
        console.log(
          `[terminal] Agent terminal ready (command: ${command}, port: ${result.port})`,
        );
    } catch (err) {
      // Clear the running flag so a retry can spawn a fresh server
      delete process.env.__AGENT_TERMINAL_RUNNING;

      // Distinguish "node-pty not installed" (expected when the user opts
      // out of the terminal feature) from real failures (port conflict,
      // native binding mismatch). Native deps are optional — log as info
      // so the dev console isn't filled with red noise.
      const code = (err as NodeJS.ErrnoException)?.code;
      const missingPty =
        code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
      if (missingPty) {
        console.log(
          "[terminal] node-pty not installed — embedded terminal disabled. " +
            "Install with `pnpm add node-pty` to enable.",
        );
      } else {
        console.error("[terminal] Failed to start PTY server:", err);
        console.error(
          "[terminal] If node-pty is installed but PTY fails to spawn, " +
            "try `pnpm rebuild node-pty` (common after switching Node " +
            "versions via fnm/nvm).",
        );
      }

      // Mount a fallback info endpoint
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: false,
          error: missingPty ? "node-pty not installed" : "PTY server failed",
        })),
      );
    }
  };
}

/** Pre-configured terminal plugin with defaults */
export const defaultTerminalPlugin = createTerminalPlugin();
