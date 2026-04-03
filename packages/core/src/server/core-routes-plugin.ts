import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
  getMethod,
} from "h3";
import type { H3Event } from "h3";
import path from "node:path";
import {
  createDefaultSSEHandler,
  createDefaultPollHandler,
  defaultSyncStatusHandler,
} from "./default-watcher.js";
import { upsertEnvFile } from "./create-server.js";
import type { EnvKeyConfig } from "./create-server.js";
import {
  getState,
  putState,
  deleteState,
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
} from "../application-state/handlers.js";

/**
 * The base path prefix for all framework-level routes.
 * All agent-native core routes live under this namespace to avoid
 * collisions with template-specific `/api/*` routes.
 */
export const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export interface CoreRoutesPluginOptions {
  /** Route path for the SSE endpoint. Default: "/_agent-native/events" */
  sseRoute?: string;
  /** Disable the SSE endpoint entirely. */
  disableSSE?: boolean;
  /** Disable the deprecated file-sync status endpoint. */
  disableFileSync?: boolean;
  /** Disable the /_agent-native/ping health check. */
  disablePing?: boolean;
  /** Env key configuration. Enables env-status and env-vars routes. */
  envKeys?: EnvKeyConfig[];
}

/**
 * Creates a Nitro plugin that mounts all standard agent-native framework routes.
 *
 * All routes are mounted under `/_agent-native/` to avoid collisions
 * with template-specific routes.
 *
 * Routes:
 *   GET    /_agent-native/poll                          — polling endpoint for change detection
 *   GET    /_agent-native/events (or custom)            — SSE endpoint for real-time sync
 *   GET    /_agent-native/file-sync/status              — (deprecated) file sync status
 *   GET    /_agent-native/ping                          — health check
 *   GET    /_agent-native/env-status                    — env key configuration status (when envKeys provided)
 *   POST   /_agent-native/env-vars                      — save env vars to .env (when envKeys provided)
 *   GET    /_agent-native/application-state/:key        — read application state
 *   PUT    /_agent-native/application-state/:key        — write application state
 *   DELETE /_agent-native/application-state/:key        — delete application state
 *   GET    /_agent-native/application-state/compose     — list compose drafts
 *   DELETE /_agent-native/application-state/compose     — delete all compose drafts
 *   GET    /_agent-native/application-state/compose/:id — get compose draft
 *   PUT    /_agent-native/application-state/compose/:id — upsert compose draft
 *   DELETE /_agent-native/application-state/compose/:id — delete compose draft
 */
export function createCoreRoutesPlugin(
  options: CoreRoutesPluginOptions = {},
): NitroPluginDef {
  return async (nitroApp: any) => {
    const P = FRAMEWORK_ROUTE_PREFIX;

    // Polling
    nitroApp.h3App.use(`${P}/poll`, createDefaultPollHandler());

    // SSE
    if (!options.disableSSE) {
      const sseRoute = options.sseRoute ?? `${P}/events`;
      nitroApp.h3App.use(sseRoute, createDefaultSSEHandler());
    }

    // File sync status (deprecated but kept for backward compat)
    if (!options.disableFileSync) {
      nitroApp.h3App.use(
        `${P}/file-sync/status`,
        defineEventHandler(() => defaultSyncStatusHandler()),
      );
    }

    // Ping
    if (!options.disablePing) {
      nitroApp.h3App.use(
        `${P}/ping`,
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
        `${P}/env-status`,
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
        `${P}/env-vars`,
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

    // ─── Application State CRUD ──────────────────────────────────────
    // Auto-mounted so templates don't need boilerplate route files.

    // Compose draft routes (more specific, mounted first)
    const composeRouter = createRouter()
      .get("/", listComposeDrafts)
      .delete("/", deleteAllComposeDrafts)
      .get("/:id", getComposeDraft)
      .put("/:id", putComposeDraft)
      .delete("/:id", deleteComposeDraft);
    nitroApp.h3App.use(`${P}/application-state/compose`, composeRouter.handler);

    // Generic application state routes
    const appStateRouter = createRouter()
      .get("/:key", getState)
      .put("/:key", putState)
      .delete("/:key", deleteState);
    nitroApp.h3App.use(`${P}/application-state`, appStateRouter.handler);
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
