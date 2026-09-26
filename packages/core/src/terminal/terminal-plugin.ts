import { defineEventHandler } from "h3";

import {
  getH3App,
  markDefaultPluginProvided,
} from "../server/framework-request-handler.js";
import { isNodeRuntime } from "../shared/runtime.js";

export interface TerminalPluginOptions {
  command?: string;
  port?: number;
  enabledInProduction?: boolean;
  authCheck?: (req: any) => boolean | Promise<boolean>;
}

let _ptyMissingLogged = false;
let _disabledLogged = false;
let _frameDetectedLogged = false;

export function createTerminalPlugin(options: TerminalPluginOptions = {}) {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "terminal");
    if (!isNodeRuntime()) return;

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

    if (process.env.FRAME_PORT) {
      if (!_frameDetectedLogged) {
        console.log("[terminal] Frame detected, skipping embedded terminal");
        _frameDetectedLogged = true;
      }
      return;
    }

    const isProd = process.env.NODE_ENV === "production";
    const enabled =
      options.enabledInProduction ??
      (process.env.AGENT_TERMINAL_ENABLED === "true" || !isProd);

    if (!enabled) {
      if (!_disabledLogged) {
        console.log(
          "[terminal] Disabled in production (set AGENT_TERMINAL_ENABLED=true to enable)",
        );
        _disabledLogged = true;
      }
      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({ available: false })),
      );
      return;
    }

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

    process.env.__AGENT_TERMINAL_RUNNING = "true"; // guard:allow-env-mutation — process-wide running flag set once at boot, before any HTTP request handling, to coordinate concurrent plugin invocations

    try {
      const { createPtyWebSocketServer } = await import("./pty-server.js");

      const result = await createPtyWebSocketServer({
        appDir: process.cwd(),
        command,
        port,
        authCheck: isProd ? options.authCheck : undefined,
        logPrefix: "[terminal]",
      });

      process.env.AGENT_TERMINAL_PORT = String(result.port); // guard:allow-env-mutation — terminal subprocess port published once at boot, not per-request

      getH3App(nitroApp).use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: true,
          wsPort: result.port,
          command,
        })),
      );

      const cleanup = () => result.close();
      process.once("SIGTERM", cleanup);
      process.once("SIGINT", cleanup);
      process.once("exit", cleanup);

      if (process.env.DEBUG)
        console.log(
          `[terminal] Agent terminal ready (command: ${command}, port: ${result.port})`,
        );
    } catch (err) {
      delete process.env.__AGENT_TERMINAL_RUNNING; // guard:allow-env-mutation — terminal subprocess boot failed, clearing boot-time sentinel so a later plugin retry can start cleanly

      const code = (err as NodeJS.ErrnoException)?.code;
      const missingPty =
        code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
      if (missingPty) {
        if (
          !_ptyMissingLogged &&
          (process.env.DEBUG || process.env.AGENT_TERMINAL_DEBUG === "1")
        ) {
          console.log(
            "[terminal] node-pty not installed — embedded terminal disabled. " +
              "Install with `pnpm add node-pty` to enable.",
          );
          _ptyMissingLogged = true;
        }
      } else {
        console.error("[terminal] Failed to start PTY server:", err);
        console.error(
          "[terminal] If node-pty is installed but PTY fails to spawn, " +
            "try `pnpm rebuild node-pty` (common after switching Node " +
            "versions via fnm/nvm).",
        );
      }

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

export const defaultTerminalPlugin = createTerminalPlugin();
