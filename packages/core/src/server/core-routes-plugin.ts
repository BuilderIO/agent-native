import { defineEventHandler, readBody, setResponseStatus, getMethod } from "h3";
import type { H3Event } from "h3";
import path from "node:path";
import {
  createDefaultSSEHandler,
  createDefaultPollHandler,
  defaultSyncStatusHandler,
} from "./default-watcher.js";
import { upsertEnvFile } from "./create-server.js";
import type { EnvKeyConfig } from "./create-server.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface CoreRoutesPluginOptions {
  /** Route path for the SSE endpoint. Default: "/api/events" */
  sseRoute?: string;
  /** Disable the SSE endpoint entirely. */
  disableSSE?: boolean;
  /** Disable the deprecated file-sync status endpoint. */
  disableFileSync?: boolean;
  /** Disable the /api/ping health check. */
  disablePing?: boolean;
  /** Env key configuration. Enables /api/env-status and /api/env-vars routes. */
  envKeys?: EnvKeyConfig[];
}

/**
 * Creates a Nitro plugin that mounts all standard agent-native framework routes.
 *
 * Routes:
 *   GET  /api/poll              — polling endpoint for change detection
 *   GET  /api/events (or custom) — SSE endpoint for real-time sync
 *   GET  /api/file-sync/status  — (deprecated) file sync status
 *   GET  /api/ping              — health check
 *   GET  /api/env-status        — env key configuration status (when envKeys provided)
 *   POST /api/env-vars          — save env vars to .env (when envKeys provided)
 */
export function createCoreRoutesPlugin(
  options: CoreRoutesPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    // Polling
    nitroApp.h3App.use("/api/poll", createDefaultPollHandler());

    // SSE
    if (!options.disableSSE) {
      const sseRoute = options.sseRoute ?? "/api/events";
      nitroApp.h3App.use(sseRoute, createDefaultSSEHandler());
    }

    // File sync status (deprecated but kept for backward compat)
    if (!options.disableFileSync) {
      nitroApp.h3App.use(
        "/api/file-sync/status",
        defineEventHandler(() => defaultSyncStatusHandler()),
      );
    }

    // Ping
    if (!options.disablePing) {
      nitroApp.h3App.use(
        "/api/ping",
        defineEventHandler(() => ({
          message: process.env.PING_MESSAGE ?? "pong",
        })),
      );
    }

    // Env key management
    if (options.envKeys) {
      const envKeys = options.envKeys;
      const allowedKeys = new Set(envKeys.map((k) => k.key));

      nitroApp.h3App.use(
        "/api/env-status",
        defineEventHandler(() =>
          envKeys.map((cfg) => ({
            key: cfg.key,
            label: cfg.label,
            required: cfg.required ?? false,
            configured: !!process.env[cfg.key],
          })),
        ),
      );

      nitroApp.h3App.use(
        "/api/env-vars",
        defineEventHandler(async (event: H3Event) => {
          if (getMethod(event) !== "POST") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }

          const body = await readBody(event);
          const { vars } = body as {
            vars?: Array<{ key: string; value: string }>;
          };

          if (!Array.isArray(vars) || vars.length === 0) {
            setResponseStatus(event, 400);
            return { error: "vars array required" };
          }

          const filtered = vars.filter(
            (v) => typeof v.key === "string" && allowedKeys.has(v.key),
          );
          if (filtered.length === 0) {
            setResponseStatus(event, 400);
            return { error: "No recognized env keys in request" };
          }

          // Write to .env file
          try {
            const envPath = path.join(process.cwd(), ".env");
            upsertEnvFile(envPath, filtered);
          } catch {
            // Edge runtime — skip file write
          }

          // Update process.env immediately
          for (const { key, value } of filtered) {
            process.env[key] = value;
          }

          return { saved: filtered.map((v) => v.key) };
        }),
      );
    }
  };
}

/**
 * Default core routes plugin — mount with no configuration needed.
 *
 * Usage in templates:
 * ```ts
 * // server/plugins/core-routes.ts
 * export { defaultCoreRoutesPlugin as default } from "@agent-native/core/server";
 * ```
 */
export const defaultCoreRoutesPlugin: NitroPluginDef = createCoreRoutesPlugin();
