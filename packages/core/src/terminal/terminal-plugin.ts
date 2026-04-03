/**
 * Nitro Plugin — Agent Terminal
 *
 * Starts a PTY WebSocket server alongside the app so the <AgentTerminal />
 * component can connect to a real CLI. Mounts a discovery endpoint at
 * /_agent-native/agent-terminal-info for the client component.
 *
 * Skips activation when running inside a harness (HARNESS_PORT is set).
 */

import { defineEventHandler } from "h3";

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
    // Always mount /_agent-native/available-clis so the client doesn't get 404s
    nitroApp.h3App.use(
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
              available: commandExists(cmd),
            });
          }
          return results;
        } catch {
          return [];
        }
      }),
    );

    // Skip if running inside a harness
    if (process.env.HARNESS_PORT) {
      console.log("[terminal] Harness detected, skipping embedded terminal");
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
      nitroApp.h3App.use(
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
      nitroApp.h3App.use(
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
      nitroApp.h3App.use(
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

    try {
      const { createPtyWebSocketServer } = await import("./pty-server.js");

      const result = await createPtyWebSocketServer({
        appDir: process.cwd(),
        command,
        port,
        authCheck: isProd ? options.authCheck : undefined,
        logPrefix: "[terminal]",
      });

      // Store port for other consumers and mark as running to prevent HMR duplication
      process.env.AGENT_TERMINAL_PORT = String(result.port);
      process.env.__AGENT_TERMINAL_RUNNING = "true";

      // Mount discovery endpoint
      nitroApp.h3App.use(
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

      console.log(
        `[terminal] Agent terminal ready (command: ${command}, port: ${result.port})`,
      );
    } catch (err) {
      console.error("[terminal] Failed to start PTY server:", err);
      console.error(
        "[terminal] Make sure node-pty is installed: pnpm add node-pty",
      );

      // Mount a fallback info endpoint
      nitroApp.h3App.use(
        "/_agent-native/agent-terminal-info",
        defineEventHandler(() => ({
          available: false,
          error: "PTY server failed to start",
        })),
      );
    }
  };
}

/** Pre-configured terminal plugin with defaults */
export const defaultTerminalPlugin = createTerminalPlugin();
